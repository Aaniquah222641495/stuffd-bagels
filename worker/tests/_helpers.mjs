// Shared by the API tests in this folder. They talk to `wrangler dev` on :8787 (see forms-api.mjs for the setup).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const B = "http://localhost:8787";
export const pw = /ADMIN_PASSWORD=(.*)/.exec(fs.readFileSync(path.join(root, ".dev.vars"), "utf8"))[1].trim();
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);
export { col };

export const log = process.argv[2]; // the fake Apps Script log (worker/tests/fake-apps-script.mjs writes it)
export const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// Rate limits are per client network, and the Worker reads it from CF-Connecting-IP (wrangler dev lets a test set it; the real edge does not).
// So each test takes a fresh pretend IPv6 /64 whenever it wants a clean slate: clearRateLimits() just switches to a new one.
const fresh = () => `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}::1`;
export let ip = fresh();
export const newIp = () => (ip = fresh());
let mailN = 0;
const runId = Date.now().toString(36);
/** A new mailbox every call: the Worker caps customer replies per address per day. */
export const uniqueEmail = (who = "test") => `${who}${runId}n${++mailN}@example.com`;

export const post = (p, body, headers = {}) =>
  fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
export const admin = (p, method = "GET", body, headers = {}) =>
  fetch(B + "/api/admin" + p, {
    method,
    headers: { "x-admin-password": pw, "CF-Connecting-IP": ip, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// The site default is 2 weeks ahead (client, 2026-11-18). Most flows here need three open Saturdays whatever day the
// test runs, so the helper opens 4 weeks unless a test says otherwise. The real default is asserted in
// saturday-rules.mjs and pickups-api.mjs.
export const setAvail = (a) => admin("/availability", "POST", { ordersEnabled: true, closedDates: [], closedMessage: "", maxWeeksAhead: 4, ...a });

/** Saturdays open for orders right now under the default rules (real clock). Index 1+ is safely away from any cut-off edge. */
export const saturdays = () => col.availableSaturdays(Date.now(), { cutoffTime: "23:59", maxWeeksAhead: 4, closedDates: [] });

/** Remove every pickup point, then create the given ones. Returns their ids. */
export async function resetPickups(points) {
  for (const p of await (await admin("/pickups")).json()) await admin(`/pickups/${p.id}`, "DELETE");
  const ids = [];
  for (const p of points) ids.push((await (await admin("/pickups", "POST", p)).json()).id);
  return ids;
}

/** Counters live in a Durable Object per client network, so "clearing" is just becoming a different pretend client. */
export function clearRateLimits() {
  newIp();
}
