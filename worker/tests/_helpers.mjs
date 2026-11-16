// Shared by the API tests in this folder. They talk to `wrangler dev` on :8787 (see forms-api.mjs for the setup).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const B = "http://localhost:8787";
export const pw = /ADMIN_PASSWORD=(.*)/.exec(fs.readFileSync(path.join(root, ".dev.vars"), "utf8"))[1].trim();
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);
export { col };

export const log = process.argv[2]; // the fake Apps Script log (worker/tests/fake-apps-script.mjs writes it)
export const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

export const post = (p, body, headers = {}) =>
  fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
export const admin = (p, method = "GET", body, headers = {}) =>
  fetch(B + "/api/admin" + p, {
    method,
    headers: { "x-admin-password": pw, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const setAvail = (a) => admin("/availability", "POST", { ordersEnabled: true, closedDates: [], closedMessage: "", ...a });

/** Saturdays open for orders right now under the default rules (real clock). Index 1+ is safely away from any cut-off edge. */
export const saturdays = () => col.availableSaturdays(Date.now(), { cutoffTime: "23:59", maxWeeksAhead: 4, closedDates: [] });

/** Remove every pickup point, then create the given ones. Returns their ids. */
export async function resetPickups(points) {
  for (const p of await (await admin("/pickups")).json()) await admin(`/pickups/${p.id}`, "DELETE");
  const ids = [];
  for (const p of points) ids.push((await (await admin("/pickups", "POST", p)).json()).id);
  return ids;
}

/** Local KV remembers rate-limit counters (all local requests share one IP). Clear them between runs. */
export function clearRateLimits() {
  const run = (args) => execFileSync("npx", ["wrangler@4.148.0", "kv", "key", ...args, "--binding", "STUFFD_KV", "--local"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();
  for (const k of JSON.parse(run(["list"]))) if (/^(rl:|fail:)/.test(k.name)) run(["delete", k.name]);
}
