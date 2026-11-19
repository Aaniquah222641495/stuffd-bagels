// Browser test (Playwright over CDP + axe) of the order form, the Yoco hand-off and result page, booking form and admin screens at 390 and 1280.
// See worker/tests/README.md for the setup (wrangler dev with the fake Yoco flags, fake Apps Script, fake Yoco). Needs WHSEC (the webhook secret
// wrangler dev was started with) and FAKE_YOCO in the environment. It writes screenshots to $SHOTS (default: the current folder).


import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, admin, setAvail, resetPickups, clearRateLimits, col } = H;
assert.ok(process.env.WHSEC, "set WHSEC (the webhook secret wrangler dev was started with)");
const mailFor = (who, w) => `${who}${H.uniqueEmail("").replace("@example.com", "")}w${w}@example.com`;
const log = process.env.FAKELOG;
const nLog = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0);
const lastLog = () => JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").at(-1));
const browser = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9444");
let axeTotal = 0;
async function axeRun(page, label) {
  await page.waitForTimeout(1300);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(" ")) })));
  console.log(`  axe ${label}: ${res.length}`, res.length ? JSON.stringify(res) : "");
  axeTotal += res.length;
}
const FAKEHOST = (process.env.FAKE_YOCO ?? "http://127.0.0.1:8798").replace(/^https?:\/\//, "");
const rules = { cutoffTime: "23:59", closedDates: [], ...H.testRules() };
const nice = col.niceDay;

for (const [w, h] of [[390, 844], [1280, 900]]) {
  console.log(`== ${w}px`);
  clearRateLimits();
  await setAvail({});
  await resetPickups([]);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, bypassCSP: true, extraHTTPHeaders: { "CF-Connecting-IP": H.ip } }); // a pretend client network per viewport (rate limits are per network)
  const aisha = mailFor("aisha", w), sam = mailFor("sam", w);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const bad = []; page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/status of (400|409|503)/.test(m.text())) bad.push(m.text()); }); // the 409 is the deliberate switched-off-point check page.on("pageerror", (e) => bad.push("pageerror " + e.message));
  const open = async () => { await page.goto(B + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(700); };

  // 1. No pickup points: ordering hidden, menu still there, markets are only information
  await open();
  await page.getByTestId("orders-hidden").waitFor();
  assert.match(await page.getByTestId("orders-hidden").textContent(), /Online ordering opens soon/);
  assert.equal(await page.getByTestId("order-form").count(), 0, "no form without a pickup point");
  assert.equal(await page.locator("[data-testid^=menu-item-]").count(), 5);
  await page.getByTestId("btn-increase-Pizza Bagel").click();
  assert.equal(await page.locator("aside[aria-label='Your order so far']").count(), 0, "no checkout bar while ordering is hidden");
  const t0 = await page.locator("body").textContent();
  assert.ok(t0.includes("Order by Wednesday, collect on Saturday."), "collection rule on the menu");
  assert.ok(t0.includes("No order needed, come and buy at the cart."), "markets: no order needed");
  assert.ok(t0.includes("Where and when do I collect my order?") && t0.includes("Order by Wednesday, collect on Saturday."), "FAQ states the rule");
  assert.equal(await page.locator("a[href*='wa.me'], a[href^='tel:']").count(), 0, "no WhatsApp or phone link on the public page (client's number is private)");
  assert.ok(!/8472|whatsapp/i.test(t0), "no phone number or WhatsApp wording on the public page");
  assert.equal(await page.locator("a[href^='mailto:stuffd.bagels@gmail.com']").count() >= 2, true, "email is still a contact path");
  await page.getByTestId("orders-hidden").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/hidden-${w}.png` });
  await axeRun(page, "ordering hidden (no pickup points)");

  // 2. Add points through the admin API; the inactive one must not appear
  const [P1] = await resetPickups([{ name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm" }, { name: "Off Point", area: "Elsewhere", active: false }, { name: "Claremont Stop", area: "Cavendish, Claremont" }]);
  await open();
  await page.getByTestId("order-form").waitFor();
  const pts = await page.locator("[data-testid=select-venue] option").allTextContents();
  assert.deepEqual(pts, ["Kenilworth Corner · Main Rd, Kenilworth", "Claremont Stop · Cavendish, Claremont"]);
  const sats = col.availableSaturdays(Date.now(), rules);
  const opts = await page.locator("[data-testid=select-saturday] option").allTextContents();
  assert.deepEqual(opts, sats.map(nice)); assert.ok(opts.every((o) => o.startsWith("Saturday")));
  const form = await page.getByTestId("order-form").textContent();
  assert.ok(form.includes(`Orders for ${nice(sats[0])} close on ${nice(col.cutoffDay(sats[0]))} at 23:59.`), "cut-off line");
  assert.ok(form.includes("Collection times: Saturdays, 10am to 1pm"), "with a pickup select, the point's times hint stays");
  assert.ok(form.includes("becomes credit for another collection Saturday or one of our markets, valid for 2 months (credit, not a refund)"), "cancellation policy shown before the order is sent");
  assert.ok(!/market/i.test(form.replace("or one of our markets, valid for 2 months", "")), "no market wording in the order form apart from the credit policy");
  console.log("  Saturdays offered:", opts.join(", "));

  // 2b. Friction changes (founder 2026-11-18): time chips, notes behind a button, single-choice rows are plain text
  const shots = process.env.SHOTS ?? ".";
  assert.equal(await page.getByTestId("input-pickup-time").count(), 0, "the free-text time box is gone");
  assert.equal(await page.getByTestId("textarea-notes").count(), 0, "notes start folded away");
  const chips = page.getByTestId("time-chips");
  assert.equal(await chips.evaluate((el) => el.tagName), "FIELDSET", "a real fieldset with a legend (radio group)");
  assert.match(await chips.locator("legend").textContent(), /Preferred time \(optional\)/);
  assert.deepEqual(await chips.locator("label").allTextContents(), ["Any time", "10am to 11am", "11am to 12pm", "12pm to 1pm"], "chips come from the old free-text hours ('10am to 1pm')");
  assert.equal(await page.getByTestId("time-chip-any").isChecked(), true, "no time chosen by default");
  assert.ok((await chips.locator("label span").first().boundingBox()).height >= 44, "chips are at least 44px tall");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/form-chips-notes-closed-${w}.png` });
  await page.getByTestId("time-chip-any").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("[data-testid=time-chip]").first().isChecked(), true, "arrow key picks the next slot");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getByTestId("time-chip-any").isChecked(), true, "and back to Any time clears it");
  await chips.locator("label", { hasText: "11am to 12pm" }).click();
  assert.equal(await page.locator("[data-testid=time-chip]").nth(1).isChecked(), true, "one tap picks a slot");
  await page.selectOption("[data-testid=select-venue]", { label: "Claremont Stop · Cavendish, Claremont" });
  assert.equal(await page.getByTestId("time-chips").count(), 0, "a point with no known hours has no chips");
  await page.selectOption("[data-testid=select-venue]", P1);
  assert.equal(await page.getByTestId("time-chip-any").isChecked(), true, "changing point drops the old pick");
  await page.getByTestId("btn-add-note").focus();
  assert.equal(await page.getByTestId("btn-add-note").getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "textarea-notes", null, { timeout: 2000 }).catch(() => {});
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "textarea-notes", "focus moves into the notes box");
  assert.equal(await page.getByTestId("btn-add-note").count(), 0);
  await page.screenshot({ path: `${shots}/form-note-open-${w}.png` });

  // 3. Validate, then Pay: the browser goes to (fake) Yoco, nothing is emailed until the signed webhook
  await page.getByTestId("btn-place-order").click();
  assert.ok(await page.locator("[data-testid=order-form] [aria-invalid=true]").count() >= 3);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "input-name");
  await axeRun(page, "order form with errors");
  await page.getByTestId("btn-increase-Pizza Bagel").click(); await page.getByTestId("btn-increase-Pizza Bagel").click(); await page.getByTestId("btn-increase-Steak'd Bagel").click();
  assert.equal(await page.locator("[data-testid^=topping-]").count(), 1, "only the priced topping (Jalapeno) is offered");
  assert.match(await page.getByTestId("topping-Extra Jalapeno").textContent(), /\+R5/); assert.equal(await page.getByTestId("topping-Extra Cheese").count(), 0, "Extra Cheese stays hidden");
  await page.getByTestId("btn-increase-Extra Jalapeno").click();
  await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(aisha);
  await page.getByTestId("select-saturday").selectOption(sats[1]); await page.getByTestId("time-chips").locator("label", { hasText: "11am to 12pm" }).click(); await page.getByTestId("textarea-notes").fill("No onions please");
  assert.ok(!(await page.getByTestId("order-form").textContent()).includes("Please add your name"), "errors clear as fields are fixed");
  assert.equal((await page.getByTestId("btn-place-order").textContent()).trim(), "Pay R310 with Yoco");
  assert.match(await page.getByTestId("pay-note").textContent(), /Pay securely on Yoco\. Your order is confirmed as soon as it's paid\./);
  const steps = await page.locator("#details ol").textContent();
  assert.ok(steps.includes("Pay with Yoco") && steps.includes("Pay securely on Yoco. Your order is confirmed straight away and we email you a confirmation."), "step 3 matches paying online");
  assert.ok(!/send it|then pay|how to pay|we'll email you how/i.test(await page.locator("#details").textContent()), "no pay-later wording in the checkout section");
  assert.match(await page.getByTestId("pay-window-note").textContent(), /Start your order before Wednesday 23:59\./);
  assert.ok(!/how to pay|Awaiting payment|Order sent/i.test(await page.locator("body").textContent()), "no 'awaiting payment' wording anywhere on the page");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/order3-filled-${w}.png` });
  await axeRun(page, "order form filled (Pay button)");
  await H.resetYoco();
  const before = nLog();
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order") && r.request().method() === "POST"), page.getByTestId("btn-place-order").click()]);
  assert.equal(resp.status(), 200);
  await page.waitForURL(new RegExp(FAKEHOST.replace(/\./g, "\\.") + "/pay/")); // (the page navigated away, so its JSON body is gone: read the reference from the fake Yoco)
  assert.equal(nLog(), before, "nothing emailed before payment");
  let { calls, visits } = await H.yocoCalls();
  const placed = { ref: calls[0].body.externalId, redirectUrl: page.url() };
  assert.match(placed.ref, /^SB-[A-Z2-9]{6}$/); assert.match(placed.redirectUrl, new RegExp("^http://" + FAKEHOST.replace(/\./g, "\\.") + "/pay/ch_"));
  assert.equal(calls.length, 1); assert.equal(calls[0].body.amount, 31000); assert.equal(visits.at(-1).referer, `${B}/`, "Yoco sees our origin as the referrer (live payments are domain-checked)");
  assert.equal(calls[0].body.cancelUrl, `${B}/order/result?r=cancel&ref=${placed.ref}`);
  const checkoutId = H.checkoutIdOf(placed.redirectUrl);

  // 3a. Back from Yoco with ?r=success: "confirming" until the signed webhook arrives, then "confirmed"
  await page.click("#ok");
  await page.waitForURL(/\/order\/result\?r=success/);
  await page.getByTestId("result-card").waitFor();
  assert.equal(await page.getByTestId("result-card").getAttribute("data-state"), "confirming");
  assert.match(await page.getByTestId("result-card").textContent(), /We're confirming your payment/);
  assert.ok(!/Order confirmed/.test(await page.getByTestId("result-card").textContent()), "the redirect alone never says confirmed");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/result-confirming-${w}.png` }); await axeRun(page, "result page: confirming");
  assert.equal((await H.webhook(H.paidPayload(checkoutId, { amount: 31000 }))).status, 200);
  await page.waitForFunction(() => document.querySelector("[data-testid=result-card]")?.getAttribute("data-state") === "confirmed", null, { timeout: 15000 });
  assert.match(await page.getByTestId("result-card").textContent(), /Order confirmed\. Your confirmation email is on its way\./);
  assert.ok((await page.getByTestId("result-card").textContent()).includes(placed.ref));
  assert.equal(await page.evaluate(() => sessionStorage.getItem("sb-order-draft")), null, "saved cart cleared once confirmed");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/result-confirmed-${w}.png` }); await axeRun(page, "result page: confirmed");
  await H.until(() => nLog() === before + 1, "the paid-order email request");
  const fwd = lastLog().body;
  assert.equal(fwd.paid, true); assert.equal(fwd.checkoutId, checkoutId);
  assert.equal(fwd.pickupPlace, "Kenilworth Corner, Main Rd, Kenilworth"); assert.equal(fwd.pickupDate, sats[1]); assert.equal(fwd.pickupTime, "11am to 12pm"); assert.equal(fwd.total, 310); assert.deepEqual(fwd.items.find((i) => i.name === "Extra Jalapeno"), { name: "Extra Jalapeno", qty: 1, unit: 5, line: 5 });
  assert.equal(await page.evaluate(() => document.querySelector("meta[name=robots]")?.getAttribute("content")), "noindex, follow", "result page is noindex");
  assert.match((await fetch(B + "/order/result")).headers.get("cache-control") ?? "", /no-store/, "result page is not cached");

  // 3b. Cancel on Yoco: "no payment taken", no email, and "Back to my order" puts the cart back
  const fill = async () => {
    await open();
    await page.getByTestId("btn-increase-Pizza Bagel").click();
    await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(aisha);
  };
  const pay = async () => { const [rr] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order") && r.request().method() === "POST"), page.getByTestId("btn-place-order").click()]); assert.equal(rr.status(), 200, "pay: order accepted"); await page.waitForURL(new RegExp(FAKEHOST.replace(/\./g, "\\.") + "/pay/")); };
  await fill(); await pay();
  await page.click("#cancel"); await page.waitForURL(/\/order\/result\?r=cancel/); await page.getByTestId("result-card").waitFor();
  assert.equal(await page.getByTestId("result-card").getAttribute("data-state"), "cancel");
  assert.match(await page.getByTestId("result-card").textContent(), /Payment cancelled\. Your order isn't placed and you haven't paid\./);
  assert.equal(nLog(), before + 1, "no email for a cancelled order");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/result-cancel-${w}.png` }); await axeRun(page, "result page: cancel");
  await page.getByTestId("back-to-order").click(); await page.getByTestId("order-form").waitFor(); await page.waitForTimeout(700);
  assert.equal(await page.getByTestId("input-name").inputValue(), "Aisha Khan", "details restored"); assert.equal(await page.getByTestId("input-email").inputValue(), aisha);
  assert.match(await page.getByTestId("btn-place-order").textContent(), /Pay R95 with Yoco/, "cart restored (1 Pizza Bagel)");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("sb-order-draft")), null, "the saved cart is used once");

  // 3c. Failure on Yoco: "didn't go through", cart restored too
  await pay(); await page.click("#fail"); await page.waitForURL(/\/order\/result\?r=failure/); await page.getByTestId("result-card").waitFor();
  assert.equal(await page.getByTestId("result-card").getAttribute("data-state"), "failure");
  assert.match(await page.getByTestId("result-card").textContent(), /Your payment didn't go through, so your order isn't placed\. Try again or use another card\./);
  assert.match(await page.getByTestId("result-card").textContent(), /SB-[A-Z2-9]{6}/, "the reference is shown for the bank-charge case");
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/result-failure-${w}.png` }); await axeRun(page, "result page: failure");
  await page.getByTestId("back-to-order").click(); await page.getByTestId("order-form").waitFor(); await page.waitForTimeout(700);
  assert.match(await page.getByTestId("btn-place-order").textContent(), /Pay R95 with Yoco/);
  assert.equal(nLog(), before + 1);

  // 3d. Result page edge states (server answers faked): still confirming, expired, unknown ref, junk query
  const stub = async (status, body) => { await page.unroute("**/api/order/status*"); await page.route("**/api/order/status*", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })); };
  const state = async (url) => { await page.goto(B + url, { waitUntil: "networkidle" }); await page.getByTestId("result-card").waitFor(); await page.waitForTimeout(1500); return page.getByTestId("result-card").getAttribute("data-state"); };
  await stub(503, { error: "x" });
  assert.equal(await state("/order/result?r=success&ref=SB-ABCDEF"), "slow");
  assert.match(await page.getByTestId("result-card").textContent(), /still being confirmed\. You'll get an email when it is\. Nothing in 15 minutes\? Email stuffd\.bagels@gmail\.com with reference SB-ABCDEF/);
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/result-slow-${w}.png` }); await axeRun(page, "result page: still confirming");
  await stub(200, { status: "expired" }); assert.equal(await state("/order/result?r=success&ref=SB-ABCDEF"), "expired");
  await stub(200, { status: "unknown" }); assert.equal(await state("/order/result?r=success&ref=SB-ABCDEF"), "notfound");
  await page.unroute("**/api/order/status*");
  assert.equal(await state("/order/result?r=success"), "notfound", "success with no reference");
  assert.equal(await state("/order/result?r=bogus&ref=%3Cscript%3E"), "unknown", "junk query");
  assert.ok(!(await page.getByTestId("result-card").innerHTML()).includes("<script"), "nothing from the query string is injected");
  await axeRun(page, "result page: junk query");
  await fill();

  // 4. A point switched off after the page loaded: clear message, list refreshes
  await page.getByTestId("btn-increase-Pizza Bagel").click();
  await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "", active: false });
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order")), page.getByTestId("btn-place-order").click()]);
  await page.waitForSelector("[role=alert]");
  assert.match(await page.locator("[role=alert]").first().textContent(), /isn't available any more/);
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId("select-venue").count(), 0, "one point left: no select any more");
  assert.equal(await page.getByTestId("pickup-fixed").locator("p").nth(1).textContent(), "Claremont Stop, Cavendish, Claremont", "list refreshed after the 409: the one left is a fixed line");
  await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm", active: true });

  // 5. Orders off, nearest Saturday closed, every Saturday closed
  await setAvail({ ordersEnabled: false, closedMessage: "Back at the next Saturday" }); await open();
  assert.match(await page.getByTestId("orders-hidden").textContent(), /Back at the next Saturday/); assert.equal(await page.getByTestId("order-form").count(), 0);
  const near = sats[0];
  await setAvail({ closedDates: [near], closedMessage: "" }); await open();
  assert.ok(!(await page.locator("[data-testid=select-saturday] option").allTextContents()).includes(nice(near)), "a closed Saturday is not offered");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/closed-saturday-${w}.png` });
  await setAvail({ closedDates: sats, closedMessage: "" }); await open();
  assert.match(await page.getByTestId("orders-hidden").textContent(), /Orders for Saturday \d+ \w+ open on .+\.|no Saturday open for orders/i);
  await setAvail({});

  // 6. The real default rules on the page clock: last Saturday of the month, opens on the 15th, closes Wednesday 23:59 (the Worker
  //    enforces the same; see saturday-rules.mjs). No helper-added Saturdays here, only the default list.
  const plainAvail = (extra = {}) => H.resetAvail(extra);
  await plainAvail();
  // The Saturday(s) offered: a select's options, or the fixed line when there is only one (rows: Saturday only, or the combined "Collect" summary).
  const offered = async () => {
    if (await page.getByTestId("select-saturday").count()) return page.locator("[data-testid=select-saturday] option").allTextContents();
    const f = page.getByTestId("saturday-fixed"); if (await f.count()) return [await f.locator("p").nth(1).textContent()];
    const c = page.getByTestId("collect-summary"); return (await c.count()) ? [/Saturday \d+ \w+/.exec(await c.textContent())[0]] : [];
  };
  const edge = async (iso) => { await page.clock.setFixedTime(new Date(iso)); await open(); return offered(); };
  const hidden = async (iso) => { await page.clock.setFixedTime(new Date(iso)); await open(); return page.getByTestId("orders-hidden").textContent(); };
  assert.match(await hidden("2026-11-14T23:59:30+02:00"), /Orders for Saturday 28 Nov open on Sunday 15 Nov\./, "before the 15th: the date it opens");
  assert.equal(await page.getByTestId("order-form").count(), 0);
  await page.getByTestId("orders-hidden").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/opens-on-15th-${w}.png` });
  await axeRun(page, "before the 15th (opens-on note)");
  let o = await edge("2026-11-15T00:00:00+02:00");
  assert.deepEqual(o, ["Saturday 28 Nov"], "from the 15th at 00:00 SAST");
  assert.equal(await page.getByTestId("saturday-note").textContent(), "Orders for Saturday 26 Dec open on Tuesday 15 Dec.", "the next one is announced");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/opens-note-${w}.png` });
  await axeRun(page, "open Saturday with next-opening note");
  assert.deepEqual(await edge("2026-11-25T23:59:30+02:00"), ["Saturday 28 Nov"], "Wednesday 23:59 still open");
  assert.match(await hidden("2026-11-26T00:00:00+02:00"), /Orders for Saturday 26 Dec open on Tuesday 15 Dec\./, "Thursday 00:00 closed; the next opens on the 15th");
  assert.deepEqual(await edge("2026-12-15T00:00:00+02:00"), ["Saturday 26 Dec"], "December");
  assert.deepEqual(await edge("2027-01-15T00:00:00+02:00"), ["Saturday 30 Jan"], "year end: January's Saturday");
  assert.match(await hidden("2026-12-31T12:00:00+02:00"), /Orders for Saturday 30 Jan open on Friday 15 Jan\./);
  await plainAvail({ cutoffTime: "12:00" });
  assert.deepEqual(await edge("2026-11-25T12:00:30+02:00"), ["Saturday 28 Nov"]);
  await page.getByTestId("order-form").scrollIntoViewIfNeeded();
  assert.ok((await page.getByTestId("order-form").textContent()).includes("close on Wednesday 25 Nov at 12:00."));
  assert.match(await hidden("2026-11-25T12:01:00+02:00"), /Orders for Saturday 26 Dec open on Tuesday 15 Dec\./, "owner cut-off 12:00 respected");
  await setAvail({});

  // 6b. One pickup point and one Saturday: one fixed "Collect" line and no selects; structured hours drive the chips; pickupTime stays a string
  await resetPickups([{ name: "Strandfontein collection", area: "Strandfontein", days: "Saturdays, 13:00 to 18:00 (times to be confirmed)", opens: "13:00", closes: "18:00" }]);
  await plainAvail();
  assert.deepEqual(await edge("2026-11-15T00:00:00+02:00"), ["Saturday 28 Nov"]);
  assert.equal(await page.getByTestId("select-venue").count() + await page.getByTestId("select-saturday").count(), 0, "nothing to choose, so no selects");
  const sum = page.getByTestId("collect-summary");
  assert.equal(await sum.locator("p").nth(1).textContent(), "Strandfontein collection, Strandfontein \u00b7 Saturday 28 Nov \u00b7 1pm to 6pm");
  const sumHint = await sum.locator("p").nth(2).textContent();
  assert.ok(sumHint.includes("Orders for Saturday 28 Nov close on Wednesday 25 Nov at 23:59.") && sumHint.includes("Times to be confirmed."), "cut-off line and the owner's caveat stay");
  assert.deepEqual(await page.getByTestId("time-chips").locator("label").allTextContents(), ["Any time", "1pm to 2pm", "2pm to 3pm", "3pm to 4pm", "4pm to 5pm", "5pm to 6pm"], "structured hours 13:00 to 18:00");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/form-single-choice-${w}.png` });
  await axeRun(page, "single pickup point and Saturday, chips");
  // payload: the form still posts the same fields; pickupTime is the chip's text. (The request is answered with a fake 400, nothing is created.)
  let posted = null;
  await page.route("**/api/order", (route) => { posted = route.request().postDataJSON(); route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "test stop" }) }); });
  await page.getByTestId("btn-increase-Pizza Bagel").click();
  await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(aisha);
  await page.getByTestId("time-chips").locator("label", { hasText: "2pm to 3pm" }).click();
  await page.getByTestId("btn-place-order").click(); await H.until(() => posted !== null, "the order request");
  assert.equal(posted.pickupTime, "2pm to 3pm"); assert.equal(posted.pickupDate, "2026-11-28"); assert.equal(posted.note, ""); assert.equal(typeof posted.pickupId, "string");
  assert.deepEqual(Object.keys(posted).sort(), ["attemptId", "email", "items", "name", "note", "phone", "pickupDate", "pickupId", "pickupTime", "toppings", "website"], "same payload fields as before");
  await page.getByTestId("time-chips").locator("label", { hasText: "Any time" }).click(); posted = null; await page.getByTestId("btn-place-order").click(); await H.until(() => posted !== null, "the second order request");
  assert.equal(posted.pickupTime, "", "Any time sends an empty pickupTime");
  await page.unroute("**/api/order");

  // 6c. Mobile order bar: phones only; fixed (no layout shift), clear of the ticker, hidden while the form is on screen, reduced-motion friendly
  const bar = page.getByTestId("order-bar");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await page.waitForTimeout(500);
  if (w < 1024) {
    await bar.waitFor();
    assert.equal((await bar.textContent()).replace(/\s+/g, " ").trim(), "1 bagel \u00b7 R95Checkout");
    const bb = await bar.boundingBox();
    assert.ok(bb.x >= 0 && bb.x + bb.width <= w && bb.y + bb.height <= h, "inside the viewport");
    const bcs = await bar.evaluate((el) => { const c = getComputedStyle(el); return { position: c.position, bottom: parseFloat(c.bottom), anim: c.animationName }; });
    assert.equal(bcs.position, "fixed", "fixed, so it never moves the page"); assert.ok(bcs.bottom >= 12, "12px clear of the bottom edge, more with a safe-area inset");
    const tickerBottom = await page.locator(".sticky").first().evaluate((el) => el.getBoundingClientRect().bottom); assert.ok(bb.y > tickerBottom, "clear of the sticky ticker");
    const h1 = await page.evaluate(() => document.documentElement.scrollHeight); await bar.evaluate((el) => { el.style.display = "none"; }); const h2 = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.equal(h1, h2, "the bar adds no page height (no layout shift)"); await bar.evaluate((el) => { el.style.display = ""; });
    assert.equal(bcs.anim, "order-bar-in", "animates in when motion is allowed");
    await page.emulateMedia({ reducedMotion: "reduce" }); assert.equal(await bar.evaluate((el) => getComputedStyle(el).animationName), "none", "no animation for reduced motion"); await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/order-bar-${w}.png` });
    await axeRun(page, "mobile order bar showing");
    await bar.locator("a").click(); await page.waitForTimeout(900);
    const fb = await page.getByTestId("order-form").boundingBox(); assert.ok(fb.y >= 28 && fb.y < h / 2, "tapping the bar scrolls the form to the top of the screen, below the ticker");
    assert.equal(await bar.count(), 0, "bar hides once the form is on screen");
    await page.getByTestId("btn-place-order").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    assert.equal(await bar.count(), 0, "never over the Pay button");
    await page.screenshot({ path: `${shots}/order-bar-gone-at-form-${w}.png` });
  } else {
    assert.equal(await bar.isVisible(), false, "no bar on desktop");
  }
  await page.getByTestId("btn-decrease-Pizza Bagel").click(); await page.getByTestId("btn-decrease-Pizza Bagel").click(); assert.equal(await bar.count(), 0, "no bar with an empty order");

  // 7. Booking form (unchanged by the order rules)
  await page.clock.setFixedTime(new Date()); await open();
  const bf = page.getByTestId("booking-form"); await bf.scrollIntoViewIfNeeded();
  await page.getByTestId("booking-name").fill("Sam Peters"); await page.getByTestId("booking-phone").fill("+27 82 999 9999"); await page.getByTestId("booking-email").fill(sam);
  await page.getByTestId("booking-date").fill("2027-02-14"); await page.getByTestId("booking-venue").fill("Kenilworth, Cape Town"); await page.getByTestId("booking-guests").fill("80");
  const b2 = nLog();
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/booking")), page.getByTestId("booking-submit").click()]);
  await page.getByTestId("booking-sent").waitFor(); assert.equal(nLog(), b2 + 1); assert.equal(lastLog().body.type, "booking");
  await axeRun(page, "booking sent");

  // 8. Admin screens
  await resetPickups([]);
  await page.goto(B + "/admin", { waitUntil: "networkidle" });
  await page.getByLabel("Admin password").fill(H.pw); await page.getByRole("button", { name: "Sign In" }).click();
  await page.getByRole("heading", { name: "Pickup Points" }).waitFor();
  assert.match(await page.getByTestId("pickups-none-active").textContent(), /No pickup points yet\. Online ordering is hidden/);
  await page.getByRole("heading", { name: "Pickup Points" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/admin-empty-${w}.png` });
  await axeRun(page, "admin, no pickup points");
  await page.getByRole("button", { name: "Add Pickup Point" }).click();
  assert.match(await page.getByRole("alert").first().textContent(), /Fill in the name and the area/);
  await page.locator("#pk-name").fill("Kenilworth Corner"); await page.locator("#pk-area").fill("Main Rd, Kenilworth"); await page.locator("#pk-days").fill("Saturdays, 10am to 1pm");
  await page.locator("#pk-opens").fill("13:00");
  await page.getByRole("button", { name: "Add Pickup Point" }).click();
  assert.match(await page.getByRole("alert").first().textContent(), /Set both the opening and closing time/, "one time without the other is refused");
  await page.locator("#pk-closes").fill("18:00");
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/admin/pickups") && r.request().method() === "POST"), page.getByRole("button", { name: "Add Pickup Point" }).click()]);
  await page.getByTestId("pickup-item").first().waitFor();
  assert.equal(await page.getByTestId("pickups-none-active").count(), 0);
  assert.equal(await page.locator("#pk-name").inputValue(), "", "form cleared after adding");
  assert.deepEqual((await (await fetch(B + "/api/pickups")).json()).map((p) => [p.opens, p.closes]), [["13:00", "18:00"]], "collection hours saved and public");
  await page.getByRole("button", { name: "Edit Kenilworth Corner" }).click();
  assert.equal(await page.locator("#pk-name").inputValue(), "Kenilworth Corner"); assert.equal(await page.locator("#pk-days").inputValue(), "Saturdays, 10am to 1pm");
  await page.locator("#pk-name").fill("Kenilworth Corner 2");
  await Promise.all([page.waitForResponse((r) => r.request().method() === "PUT"), page.getByRole("button", { name: "Save Changes" }).click()]);
  await page.getByRole("button", { name: "Edit Kenilworth Corner 2" }).waitFor();
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/admin-list-${w}.png` }); await axeRun(page, "admin, one pickup point");
  await Promise.all([page.waitForResponse((r) => r.request().method() === "PUT"), page.getByRole("button", { name: "Switch off Kenilworth Corner 2" }).click()]);
  await page.getByTestId("pickups-none-active").waitFor();
  assert.match(await page.getByTestId("pickups-none-active").textContent(), /No pickup point is switched on/);
  assert.deepEqual(await (await fetch(B + "/api/pickups")).json(), [], "public list empty while switched off");
  await Promise.all([page.waitForResponse((r) => r.request().method() === "PUT"), page.getByRole("button", { name: "Switch on Kenilworth Corner 2" }).click()]);
  await page.waitForFunction(() => !document.querySelector("[data-testid=pickups-none-active]"));
  assert.deepEqual((await (await fetch(B + "/api/pickups")).json()).map((p) => [p.opens, p.closes]), [["13:00", "18:00"]], "hours survive an edit and a switch off and on");
  await page.getByRole("button", { name: "Remove Kenilworth Corner 2" }).click();
  await page.getByRole("button", { name: "No, keep it" }).click();
  assert.equal(await page.getByTestId("pickup-item").count(), 1);
  await page.getByRole("button", { name: "Remove Kenilworth Corner 2" }).click();
  await Promise.all([page.waitForResponse((r) => r.request().method() === "DELETE"), page.getByRole("button", { name: "Yes, remove Kenilworth Corner 2" }).click()]);
  await page.getByTestId("pickups-none-active").waitFor();
  // markets and collection Saturdays (only while the bundled MGM weekend and the test dates are still in the future)
  if (Date.now() < Date.parse("2026-12-15T00:00:00+02:00")) {
    const mk = await (await admin("/events", "POST", { name: "Test Market", venue: "Test hall", start: "2026-12-27", end: "2026-12-27" })).json();
    await page.reload(); await page.getByTestId("collection-saturdays").waitFor();
    const skipped = page.getByTestId("skipped-2026-12-26");
    assert.match(await skipped.textContent(), /Skipped: Test Market that weekend/, "a default Saturday with a market on its Sunday is shown as skipped");
    assert.ok(!(await page.getByTestId("sat-2026-12-26").count()), "and not in the list");
    await skipped.getByRole("button", { name: /back on the list/ }).click();
    assert.equal(await page.getByTestId("sat-2026-12-26").count(), 1, "put back");
    assert.match(await page.getByTestId("warn-2026-12-26").textContent(), /Test Market is on that weekend/, "a put-back Saturday carries the warning");
    await page.getByLabel("Saturday to add").fill("2026-12-19"); await page.getByRole("button", { name: "Add Saturday" }).click();
    assert.match(await page.getByTestId("warn-2026-12-19").textContent(), /MGM '26 is on that weekend/, "a hand-added Saturday on the MGM weekend stays, with a warning");
    await axeRun(page, "admin with market warnings");
    await page.screenshot({ path: `${process.env.SHOTS ?? "."}/admin-market-warnings-${w}.png`, fullPage: false });
    await admin(`/events/${mk.id}`, "DELETE");
    await page.reload(); await page.getByTestId("collection-saturdays").waitFor();
  }
  // collection rules
  await page.locator("#cutoff-time").fill("20:00");
  const listed = await page.locator("[data-testid^=sat-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice(4)));
  assert.ok(listed.length >= 5, "the admin lists the collection Saturdays");
  await page.getByRole("button", { name: `Remove ${nice(listed[0])} from collection Saturdays` }).click();
  assert.equal(await page.getByTestId(`sat-${listed[0]}`).count(), 0, "removed from the list");
  const farSat = (() => { const t = Date.now() + 120 * 86400000; let d = new Date(t); while (d.getUTCDay() !== 6) d = new Date(d.getTime() + 86400000); return d.toISOString().slice(0, 10); })();
  await page.getByLabel("Saturday to add").fill(farSat); await page.getByRole("button", { name: "Add Saturday" }).click();
  assert.equal(await page.getByTestId(`sat-${farSat}`).count(), 1, "added to the list");
  const earlier = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel(`Orders open on, for ${nice(listed[1])}`).fill(earlier);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/admin/availability") && r.request().method() === "POST"), page.getByRole("button", { name: "Save Availability and Rules" }).click()]);
  await page.getByText("Saved").waitFor();
  const pubA = await (await fetch(B + "/api/availability")).json(); assert.equal(pubA.cutoffTime, "20:00");
  assert.ok(!pubA.addedSaturdays.includes(listed[0]) && !pubA.removedSaturdays.includes(listed[1]), "removing an added Saturday just drops it");
  assert.ok(pubA.addedSaturdays.includes(farSat), "added Saturday saved"); assert.equal(pubA.opensOn[listed[1]], earlier, "opening day saved");
  await page.locator("#collection-rules, #cutoff-time").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/admin-rules-${w}.png` });
  await axeRun(page, "admin with collection rules");
  await setAvail({});
  console.log("  console problems:", JSON.stringify(bad)); assert.equal(bad.length, 0);
  await ctx.close();
}
await resetPickups([]); clearRateLimits(); await setAvail({});
console.log("axe violations total:", axeTotal); assert.equal(axeTotal, 0);
console.log("E2E2 PASSED");
await browser.close();
