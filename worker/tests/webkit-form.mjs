// WebKit check of the order form at 390 and 1280 (the main e2e drives Chrome over CDP). Needs wrangler dev + fakes like e2e-browser.mjs.
// Run: SB_BASE=... PW=<playwright-core> AXE=<axe.min.js> SHOTS=<dir> node worker/tests/webkit-form.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PW);
const axeSrc = fs.readFileSync(process.env.AXE, "utf8");
const H = await import("./_helpers.mjs");
const { B, setAvail, resetPickups, resetAvail } = H;
const shots = process.env.SHOTS ?? ".";
const browser = await webkit.launch();
let axeTotal = 0;
for (const [w, h] of [[390, 844], [1280, 900]]) {
  console.log(`== webkit ${w}px`);
  await resetPickups([{ name: "Strandfontein collection", area: "Strandfontein", days: "Saturdays, 13:00 to 18:00 (times to be confirmed)", opens: "13:00", closes: "18:00" }]);
  await resetAvail();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, bypassCSP: true, extraHTTPHeaders: { "CF-Connecting-IP": H.ip } });
  // WebKit obeys the CSP "upgrade-insecure-requests" even for http://localhost and then cannot load the page's own files, so for this
  // local check only, the CSP header is dropped from responses. (Production serves it over https, where it is harmless.)
  await ctx.route("**/*", async (route) => { const r = await route.fetch(); const headers = { ...r.headers() }; delete headers["content-security-policy"]; await route.fulfill({ response: r, headers }); });
  const page = await ctx.newPage();
  const bad = []; page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/status of 400/.test(m.text())) bad.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-11-15T00:00:00+02:00"));
  await page.goto(B + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  // 1 single choice
  assert.equal(await page.getByTestId("select-venue").count() + await page.getByTestId("select-saturday").count(), 0);
  assert.equal(await page.getByTestId("collect-summary").locator("p").nth(1).textContent(), "Strandfontein collection, Strandfontein · Saturday 28 Nov · 1pm to 6pm");
  // 2 chips, keyboard, clear
  const chips = page.getByTestId("time-chips");
  assert.deepEqual(await chips.locator("label").allTextContents(), ["Any time", "1pm to 2pm", "2pm to 3pm", "3pm to 4pm", "4pm to 5pm", "5pm to 6pm"]);
  await chips.locator("label", { hasText: "2pm to 3pm" }).click();
  assert.equal(await page.locator("[data-testid=time-chip]").nth(1).isChecked(), true);
  await page.locator("[data-testid=time-chip]").nth(1).focus(); // (Safari does not focus a radio when its label is clicked, so focus it as Tab would)
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("[data-testid=time-chip]").nth(2).isChecked(), true, "arrow key moves the pick");
  await chips.locator("label", { hasText: "Any time" }).click();
  assert.equal(await page.getByTestId("time-chip-any").isChecked(), true);
  // 3 notes
  assert.equal(await page.getByTestId("textarea-notes").count(), 0);
  await page.getByTestId("btn-add-note").click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "textarea-notes", null, { timeout: 3000 });
  await page.getByTestId("order-form").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/webkit-form-${w}.png` });
  // 4 bar
  await page.getByTestId("btn-increase-Pizza Bagel").click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await page.waitForTimeout(500);
  const bar = page.getByTestId("order-bar");
  if (w < 1024) {
    await bar.waitFor();
    assert.equal((await bar.textContent()).replace(/\s+/g, " ").trim(), "1 bagel · R95Checkout");
    const bb = await bar.boundingBox(); assert.ok(bb.x >= 0 && bb.x + bb.width <= w && bb.y + bb.height <= h);
    await page.screenshot({ path: `${shots}/webkit-order-bar-${w}.png` });
    await bar.locator("a").click(); await page.waitForTimeout(900);
    assert.ok((await page.getByTestId("order-form").boundingBox()).y < h / 2, "form scrolled into view");
    assert.equal(await bar.count(), 0, "bar hidden at the form");
  } else assert.equal(await bar.isVisible(), false);
  // axe
  await page.waitForTimeout(1300); await page.evaluate(axeSrc);
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((x) => x.id));
  console.log("  axe:", v.length, JSON.stringify(v)); axeTotal += v.length;
  console.log("  console problems:", JSON.stringify(bad)); assert.equal(bad.length, 0);
  await ctx.close();
}
await resetPickups([]); await setAvail({});
assert.equal(axeTotal, 0);
console.log("WEBKIT PASSED");
await browser.close();
