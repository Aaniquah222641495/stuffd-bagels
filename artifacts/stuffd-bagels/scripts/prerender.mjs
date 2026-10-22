// Runs after `vite build`. Saves the page as finished HTML so search engines and AI
// crawlers (most of which don't run JavaScript) can read the menu, prices, FAQ, title and
// structured data. React then attaches to this HTML in the browser (hydrateRoot).
// Live data (this week's events, orders open/closed) still loads in the browser from /api
// after the page opens, so nothing stale is baked into the HTML.
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../dist/public");
const serverEntry = path.resolve(here, "../dist/server/entry-server.js");

const { render, PAGES, NOT_FOUND, headHtml, SITE_URL, LAST_UPDATED, menuPricingObject } = await import(
  pathToFileURL(serverEntry).href
);
if (!SITE_URL || !LAST_UPDATED) throw new Error("entry-server.tsx must export SITE_URL and LAST_UPDATED");

const template = await readFile(path.join(out, "index.html"), "utf8");
if (!template.includes("<!--seo-->") || !template.includes('<div id="root"></div>')) {
  throw new Error("index.html is missing the <!--seo--> marker or the empty #root div");
}

const fileFor = (p) => (p === "/" ? "index.html" : p === NOT_FOUND.path ? "404.html" : `${p.slice(1)}.html`);

for (const page of [...PAGES, NOT_FOUND]) {
  const routePath = page === NOT_FOUND ? "/this-page-does-not-exist" : page.path;
  const body = await render(routePath);
  if (body.includes("<script")) throw new Error(`Inline script in ${page.path}: it would break the CSP`);
  if (page.path === "/") {
    // Guard: every menu price in the structured data must be visible in the page.
    const text = body.replace(/<!-- -->/g, "");
    for (const [name, item] of Object.entries(menuPricingObject)) {
      if (!text.includes(name) || !text.includes(`R${item.price}`)) throw new Error(`Home page doesn't show ${name} at R${item.price}`);
    }
  }
  const html = template
    .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, headHtml(page))
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  await writeFile(path.join(out, fileFor(page.path)), html);
  console.log(`prerendered ${page.path.padEnd(5)} -> ${fileFor(page.path)} (${Math.round(body.length / 1024)} KB)`);
}

const urls = PAGES.filter((p) => !p.noindex)
  .map((p) => `  <url><loc>${SITE_URL}${p.path}</loc><lastmod>${LAST_UPDATED}</lastmod></url>`)
  .join("\n");
await writeFile(
  path.join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
console.log(`sitemap.xml with ${PAGES.length} page(s)`);

await rm(path.resolve(here, "../dist/server"), { recursive: true, force: true });
