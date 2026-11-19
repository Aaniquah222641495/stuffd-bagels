// Finds distorted images: compares each rendered <img> box with the picture's real shape (naturalWidth / naturalHeight).
// An image is "stretched" when its box ratio differs from the real ratio by more than 3% AND object-fit would not
// crop it (object-fit: fill or none). object-fit cover / contain keep the real proportions, so they pass.
// Needs wrangler dev on :8787 and arm64 Chrome on :9444 (see README). Run: PW=<playwright-core path> node worker/tests/image-ratios.mjs
// BASE=<url> checks a deployed site instead (no signed-in admin, no spoofed IP header: the real edge refuses it).
// Admin is checked signed in (password from .dev.vars via _helpers.mjs).
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { B, pw, ip } from "./_helpers.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.PW);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9444");
let checked = 0, bad = [];
for (const [w, h] of [[390, 844], [1280, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, bypassCSP: true, reducedMotion: "reduce", extraHTTPHeaders: process.env.BASE ? {} : { "CF-Connecting-IP": ip } });
  const page = await ctx.newPage();
  for (const path of process.env.BASE ? ["/", "/privacy", "/terms", "/admin"] : ["/", "/privacy", "/terms", "/admin", "/admin#signed-in"]) {
    await page.goto((process.env.BASE ?? B) + path.replace("#signed-in", ""), { waitUntil: "networkidle" });
    if (path.endsWith("#signed-in")) { await page.getByLabel("Admin password").fill(pw); await page.getByRole("button", { name: "Sign In" }).click(); await page.waitForTimeout(1500); }
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(1200);
    const rows = await page.evaluate(() => [...document.images].map((i) => {
      const r = i.getBoundingClientRect(), cs = getComputedStyle(i);
      return { src: (i.currentSrc || i.src).replace(location.origin, ""), nw: i.naturalWidth, nh: i.naturalHeight, bw: i.offsetWidth, bh: i.offsetHeight, fit: cs.objectFit, shown: r.width > 0 && r.height > 0 && cs.display !== "none" };
    }));
    for (const i of rows) {
      if (!i.shown || !i.nw || !i.nh) continue; // hidden at this width, or not loaded
      checked++;
      const real = i.nw / i.nh, box = i.bw / i.bh, off = Math.abs(box / real - 1);
      if (off > 0.03 && (i.fit === "fill" || i.fit === "none")) bad.push(`${w}px ${path} ${i.src}: box ${i.bw}x${i.bh} (${box.toFixed(3)}) vs real ${i.nw}x${i.nh} (${real.toFixed(3)}), object-fit ${i.fit}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`checked ${checked} rendered images`);
if (bad.length) { console.log(bad.join("\n")); assert.fail(`${bad.length} stretched image(s)`); }
console.log("image-ratios: no stretched images");
