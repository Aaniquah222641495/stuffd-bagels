import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root")!;

// Pages are prerendered at build time (scripts/prerender.mjs), so React attaches to the
// existing HTML instead of redrawing it. Falls back to a normal render in dev.
if (root.hasChildNodes()) {
  hydrateRoot(root, <App />);
} else {
  createRoot(root).render(<App />);
}
