// Browser test (Playwright over CDP + axe) of the order form, booking form and admin pickup screens at 390 and 1280.
// See worker/tests/README.md for the setup. It writes screenshots to $SHOTS (default: the current folder).


import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, admin, setAvail, resetPickups, clearRateLimits, col } = H;
const mailFor = (who, w) => `${who}${H.uniqueEmail("").replace("@example.com", "")}w${w}@example.com`;
const log = process.env.FAKELOG;
const nLog = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0);
const lastLog = () => JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").at(-1));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9444");
let axeTotal = 0;
async function axeRun(page, label) {
  await page.waitForTimeout(1300);
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(" ")) })));
  console.log(`  axe ${label}: ${res.length}`, res.length ? JSON.stringify(res) : "");
  axeTotal += res.length;
}
const rules = { cutoffTime: "23:59", maxWeeksAhead: 4, closedDates: [] };
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
  const bad = []; page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/status of 409/.test(m.text())) bad.push(m.text()); }); // the 409 is the deliberate switched-off-point check page.on("pageerror", (e) => bad.push("pageerror " + e.message));
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
  assert.equal(await page.locator("a[href*='wa.me'][href*='text=']").count(), 0);
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
  assert.ok(form.includes("Collection times: Saturdays, 10am to 1pm"), "point's times hint");
  assert.ok(!/market/i.test(form), "no market wording in the order form");
  console.log("  Saturdays offered:", opts.join(", "));

  // 3. Validate, send
  await page.getByTestId("btn-place-order").click();
  assert.ok(await page.locator("[data-testid=order-form] [aria-invalid=true]").count() >= 3);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "input-name");
  await axeRun(page, "order form with errors");
  await page.getByTestId("btn-increase-Pizza Bagel").click(); await page.getByTestId("btn-increase-Pizza Bagel").click(); await page.getByTestId("btn-increase-Steak'd Bagel").click();
  assert.equal(await page.locator("[data-testid^=topping-]").count(), 1, "only the priced topping (Jalapeno) is offered");
  assert.match(await page.getByTestId("topping-Extra Jalapeno").textContent(), /\+R5/); assert.equal(await page.getByTestId("topping-Extra Cheese").count(), 0, "Extra Cheese stays hidden");
  await page.getByTestId("btn-increase-Extra Jalapeno").click();
  await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(aisha);
  await page.getByTestId("select-saturday").selectOption(sats[1]); await page.getByTestId("input-pickup-time").fill("around 11am"); await page.getByTestId("textarea-notes").fill("No onions please");
  assert.ok(!(await page.getByTestId("order-form").textContent()).includes("Please add your name"), "errors clear as fields are fixed");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/order2-filled-${w}.png` });
  const before = nLog();
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order") && r.request().method() === "POST"), page.getByTestId("btn-place-order").click()]);
  assert.equal(resp.status(), 200);
  await page.getByTestId("order-sent").waitFor();
  assert.equal(nLog(), before + 1);
  const sent = await page.getByTestId("order-sent").textContent();
  for (const re of [/Order sent/, /Awaiting payment/, /confirmed once it's paid/, /SB-[A-Z2-9]{6}/, /R310/, /Kenilworth Corner, Main Rd, Kenilworth/, new RegExp(nice(sats[1])), /around 11am/, new RegExp(aisha.replace(/\./g, "\\."))]) assert.match(sent, re);
  const fwd = lastLog().body;
  assert.equal(fwd.pickupPlace, "Kenilworth Corner, Main Rd, Kenilworth"); assert.equal(fwd.pickupDate, sats[1]); assert.equal(fwd.pickupTime, "around 11am"); assert.equal(fwd.total, 310); assert.deepEqual(fwd.items.find((i) => i.name === "Extra Jalapeno"), { name: "Extra Jalapeno", qty: 1, unit: 5, line: 5 });
  await page.screenshot({ path: `${process.env.SHOTS ?? "."}/order2-sent-${w}.png` }); await axeRun(page, "order sent");

  // 4. A point switched off after the page loaded: clear message, list refreshes
  await page.getByRole("button", { name: "Start another order" }).click();
  await page.getByTestId("btn-increase-Pizza Bagel").click();
  await page.getByTestId("input-name").fill("Aisha Khan"); await page.getByTestId("input-phone").fill("082 123 4567"); await page.getByTestId("input-email").fill(aisha);
  await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "", active: false });
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order")), page.getByTestId("btn-place-order").click()]);
  await page.waitForSelector("[role=alert]");
  assert.match(await page.locator("[role=alert]").first().textContent(), /isn't available any more/);
  await page.waitForTimeout(600);
  assert.deepEqual(await page.locator("[data-testid=select-venue] option").allTextContents(), ["Claremont Stop · Cavendish, Claremont"], "list refreshed after the 409");
  await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm", active: true });

  // 5. Orders off, nearest Saturday closed, every Saturday closed
  await setAvail({ ordersEnabled: false, closedMessage: "Back at the next Saturday" }); await open();
  assert.match(await page.getByTestId("orders-hidden").textContent(), /Back at the next Saturday/); assert.equal(await page.getByTestId("order-form").count(), 0);
  const near = col.nextCalendarSaturday(Date.now());
  await setAvail({ closedDates: [near], closedMessage: "" }); await open();
  if (sats[0] === near) {
    assert.match(await page.getByTestId("saturday-note").textContent(), new RegExp(`We're closed on ${nice(near)}\\. You're ordering for ${nice(sats[1])}\\.`));
    assert.ok(!(await page.locator("[data-testid=select-saturday] option").allTextContents()).includes(nice(near)));
    await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/closed-saturday-${w}.png` });
  }
  await setAvail({ closedDates: sats, closedMessage: "" }); await open();
  assert.match(await page.getByTestId("orders-hidden").textContent(), /no Saturday open for orders/i);
  await setAvail({});

  // 6. The page clock at the cut-off edge (the Worker enforces the same rule; see saturday-rules.mjs)
  const edge = async (iso) => { await page.clock.setFixedTime(new Date(iso)); await open(); return page.locator("[data-testid=select-saturday] option").allTextContents(); };
  let o = await edge("2026-11-18T23:59:30+02:00");
  assert.equal(o[0], "Saturday 21 Nov"); assert.equal(await page.getByTestId("saturday-note").count(), 0);
  o = await edge("2026-11-19T00:00:00+02:00");
  assert.equal(o[0], "Saturday 28 Nov"); assert.ok(!o.includes("Saturday 21 Nov"));
  assert.equal(await page.getByTestId("saturday-note").textContent(), "Orders for this Saturday closed on Wednesday. You're ordering for Saturday 28 Nov.");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/cutoff-note-${w}.png` });
  await axeRun(page, "after cut-off note");
  o = await edge("2026-07-30T00:00:00+02:00"); assert.equal(o[0], "Saturday 8 Aug", "Sat 1 Aug closed on Wed 29 Jul: month end");
  o = await edge("2026-12-31T00:00:00+02:00"); assert.equal(o[0], "Saturday 9 Jan", "Sat 2 Jan closed Wed 30 Dec: year end");
  await setAvail({ cutoffTime: "12:00", maxWeeksAhead: 2 });
  o = await edge("2026-11-18T12:01:00+02:00"); assert.equal(o[0], "Saturday 28 Nov"); assert.equal(o.length, 1, "2 weeks ahead from Wed 18 Nov reaches only Sat 28 Nov");
  await page.getByTestId("order-form").scrollIntoViewIfNeeded();
  assert.ok((await page.getByTestId("order-form").textContent()).includes("close on Wednesday 25 Nov at 12:00."));
  await setAvail({});

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
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/admin/pickups") && r.request().method() === "POST"), page.getByRole("button", { name: "Add Pickup Point" }).click()]);
  await page.getByTestId("pickup-item").first().waitFor();
  assert.equal(await page.getByTestId("pickups-none-active").count(), 0);
  assert.equal(await page.locator("#pk-name").inputValue(), "", "form cleared after adding");
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
  assert.equal((await (await fetch(B + "/api/pickups")).json()).length, 1);
  await page.getByRole("button", { name: "Remove Kenilworth Corner 2" }).click();
  await page.getByRole("button", { name: "No, keep it" }).click();
  assert.equal(await page.getByTestId("pickup-item").count(), 1);
  await page.getByRole("button", { name: "Remove Kenilworth Corner 2" }).click();
  await Promise.all([page.waitForResponse((r) => r.request().method() === "DELETE"), page.getByRole("button", { name: "Yes, remove Kenilworth Corner 2" }).click()]);
  await page.getByTestId("pickups-none-active").waitFor();
  // collection rules
  await page.locator("#cutoff-time").fill("20:00"); await page.locator("#weeks-ahead").fill("2");
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/admin/availability") && r.request().method() === "POST"), page.getByRole("button", { name: "Save Availability and Rules" }).click()]);
  await page.getByText("Saved").waitFor();
  const pubA = await (await fetch(B + "/api/availability")).json(); assert.equal(pubA.cutoffTime, "20:00"); assert.equal(pubA.maxWeeksAhead, 2);
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
