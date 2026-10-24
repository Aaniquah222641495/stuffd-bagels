// Build-time entry: renders one page to HTML for scripts/prerender.mjs.
import { prerenderToNodeStream } from "react-dom/static";
import App from "./App";

export { PAGES, NOT_FOUND, headHtml, SITE_URL, LAST_UPDATED } from "./seo";
export { menuPricingObject } from "./content";

export async function render(path: string): Promise<string> {
  const { prelude } = await prerenderToNodeStream(<App ssrPath={path} />);
  let html = "";
  for await (const chunk of prelude) html += chunk.toString();
  return html;
}
