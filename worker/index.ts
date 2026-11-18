// Stuff'd Bagels Worker (ADR-0028, revised to Workers static assets).
// Only /api and /api/* reach this code (wrangler.jsonc: assets.run_worker_first). Everything
// else is served straight from the static assets, so pages and images stay free requests.
import { requireAdmin } from "./auth";
export { Limiter } from "./limiter";
export { Orders } from "./orders";
import { handleForm } from "./forms";
import { handleAttention, handleStatus, handleWebhook } from "./payments";
import { HttpError, errorResponse, json, plainHttpRefused, readJsonObject, withNoindex } from "./http";
import {
  LIMITS,
  parseAvailabilityInput,
  parseEventInput,
  parsePickupInput,
  publicAvailability,
  publicEvents,
  publicPickups,
  readAvailability,
  keepOpenSaturdays,
  readEvents,
  readPickups,
  withToday,
  writeAvailability,
  writeEvents,
  writePickups,
} from "./store";

export interface Env {
  ASSETS: Fetcher;
  STUFFD_KV?: KVNamespace;
  ADMIN_PASSWORD?: string;
  // Keys the rate-limit counter hashes (worker/limiter-client.ts limiterSalt). Secret, 16+ characters; falls back to ADMIN_PASSWORD if unset.
  LIMITER_SALT?: string;
  // "production" (top level of wrangler.jsonc), "preview" (env.preview) or "development" (tests). Unset counts as production.
  APP_ENV?: string;
  // "1" on the preview: every page and file gets X-Robots-Tag: noindex, nofollow (the preview must never be indexed).
  NOINDEX?: string;
  // Web app URL of the client's Google Apps Script (apps-script/Code.gs). Worker secret, set by the founder.
  APPS_SCRIPT_URL?: string;
  // Required shared token (32+ random characters), must match SHARED_TOKEN in the script. No token, no forwarding.
  APPS_SCRIPT_TOKEN?: string;
  // Durable Object namespace for the strongly consistent counters (worker/limiter.ts).
  LIMITER?: DurableObjectNamespace;
  // Durable Object namespace for pending and paid orders (worker/orders.ts, ADR-0041).
  ORDERS?: DurableObjectNamespace;
  // Yoco (ADR-0041). Secrets set by the founder: YOCO_SECRET_KEY, YOCO_WEBHOOK_SECRET. Plain vars in wrangler.jsonc: YOCO_MODE, SITE_ORIGIN.
  YOCO_SECRET_KEY?: string;
  YOCO_WEBHOOK_SECRET?: string;
  YOCO_MODE?: string;
  SITE_ORIGIN?: string;
  // Tests only: honoured only for http://127.0.0.1 (a local fake Yoco).
  YOCO_API_BASE?: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function needKv(env: Env): KVNamespace {
  if (!env.STUFFD_KV) throw new HttpError(503, "Could not save. Try again in a minute.");
  return env.STUFFD_KV;
}

function methodOnly(request: Request, allowed: string[]): void {
  if (!allowed.includes(request.method)) {
    throw new HttpError(405, "Method not allowed", { Allow: allowed.join(", ") });
  }
}

async function handleAdmin(request: Request, env: Env, parts: string[]): Promise<Response> {
  // parts = ["api", "admin", ...rest]. Authenticate before looking at anything else, so an
  // unauthenticated caller can't tell which admin routes exist.
  await requireAdmin(request, env);
  const [, , resource, id, ...extra] = parts;

  if (resource === "availability" && id === undefined) {
    methodOnly(request, ["GET", "POST"]);
    const kv = needKv(env);
    if (request.method === "GET") return json(withToday(await readAvailabilitySafe(kv)));
    const next = parseAvailabilityInput(await readJsonObject(request), await readAvailabilitySafe(kv));
    await writeAvailability(kv, next);
    return json({ ok: true });
  }

  if (resource === "events" && id === undefined) {
    methodOnly(request, ["GET", "POST"]);
    const kv = needKv(env);
    const events = await readEventsSafe(kv);
    if (request.method === "GET") return json(events);
    const input = parseEventInput(await readJsonObject(request));
    if (events.length >= LIMITS.events) throw new HttpError(400, "Too many events. Remove one first.");
    const newId = crypto.randomUUID();
    await writeEvents(kv, [...events, { id: newId, ...input }]);
    const kept = await keepOpenSaturdays(kv, events, { id: newId, ...input });
    return json({ ok: true, id: newId, keptSaturdays: kept });
  }

  if (resource === "events" && id !== undefined && extra.length === 0) {
    methodOnly(request, ["DELETE"]);
    if (!SAFE_ID.test(id)) throw new HttpError(400, "Invalid fields");
    const kv = needKv(env);
    const events = await readEventsSafe(kv);
    if (!events.some((e) => e.id === id)) throw new HttpError(404, "Not found");
    await writeEvents(kv, events.filter((e) => e.id !== id));
    return json({ ok: true });
  }

  // Pickup points: same auth, body limits and error style as events, plus edit (PUT) because a point's
  // name, address and on/off switch change more often than a market does.
  if (resource === "pickups" && id === undefined) {
    methodOnly(request, ["GET", "POST"]);
    const kv = needKv(env);
    const points = await readPickupsSafe(kv);
    if (request.method === "GET") return json(points);
    const input = parsePickupInput(await readJsonObject(request));
    if (points.length >= LIMITS.pickups) throw new HttpError(400, "Too many pickup points. Remove one first.");
    const newId = crypto.randomUUID();
    await writePickups(kv, [...points, { id: newId, ...input }]);
    return json({ ok: true, id: newId });
  }

  if (resource === "pickups" && id !== undefined && extra.length === 0) {
    methodOnly(request, ["PUT", "DELETE"]);
    if (!SAFE_ID.test(id)) throw new HttpError(400, "Invalid fields");
    const kv = needKv(env);
    const points = await readPickupsSafe(kv);
    if (!points.some((p) => p.id === id)) throw new HttpError(404, "Not found");
    if (request.method === "DELETE") {
      await writePickups(kv, points.filter((p) => p.id !== id));
      return json({ ok: true });
    }
    const input = parsePickupInput(await readJsonObject(request));
    await writePickups(kv, points.map((p) => (p.id === id ? { id, ...input } : p)));
    return json({ ok: true });
  }

  if (resource === "orders" && id === "attention" && extra.length === 0) {
    methodOnly(request, ["GET"]);
    return handleAttention(env);
  }

  throw new HttpError(404, "Not found");
}

async function readPickupsSafe(kv: KVNamespace) {
  try {
    return await readPickups(kv);
  } catch {
    throw new HttpError(503, "Storage is not responding. Try again in a minute.");
  }
}

// Admin reads: a KV failure is a 503 (the owner should know), not a silent fallback.
async function readAvailabilitySafe(kv: KVNamespace) {
  try {
    return await readAvailability(kv);
  } catch {
    throw new HttpError(503, "Storage is not responding. Try again in a minute.");
  }
}
async function readEventsSafe(kv: KVNamespace) {
  try {
    return await readEvents(kv);
  } catch {
    throw new HttpError(503, "Storage is not responding. Try again in a minute.");
  }
}

async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  let parts: string[];
  try {
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, "Invalid request"); // malformed %-escape in the path
  }

  if (parts[1] === "admin") return handleAdmin(request, env, parts);

  if (parts.length === 2 && parts[1] === "healthz") {
    methodOnly(request, ["GET", "HEAD"]);
    return json({ status: "ok" });
  }
  if (parts.length === 2 && parts[1] === "availability") {
    methodOnly(request, ["GET", "HEAD"]);
    return json(await publicAvailability(env.STUFFD_KV), 200, "public");
  }
  if (parts.length === 2 && parts[1] === "events") {
    methodOnly(request, ["GET", "HEAD"]);
    return json(await publicEvents(env.STUFFD_KV), 200, "public");
  }
  if (parts.length === 2 && parts[1] === "pickups") {
    methodOnly(request, ["GET", "HEAD"]);
    // Only what customers need: active points, no internal fields.
    const list = (await publicPickups(env.STUFFD_KV)).map(({ id, name, area, days }) => ({ id, name, area, days }));
    return json(list, 200, "public");
  }
  if (parts.length === 2 && (parts[1] === "order" || parts[1] === "booking")) {
    methodOnly(request, ["POST"]);
    return handleForm(request, env, parts[1]);
  }
  if (parts.length === 3 && parts[1] === "order" && parts[2] === "status") {
    methodOnly(request, ["GET", "HEAD"]);
    return handleStatus(request, env);
  }
  if (parts.length === 3 && parts[1] === "yoco" && parts[2] === "webhook") {
    methodOnly(request, ["POST"]);
    return handleWebhook(request, env);
  }
  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(request);
      return env.NOINDEX === "1" ? withNoindex(res) : res;
    }
    // The API is HTTPS only (passwords and orders). The zone's "Always Use HTTPS" redirects browsers; this refuses anything that
    // still arrives over plain HTTP. wrangler dev on this computer is plain HTTP, so loopback is allowed.
    if (plainHttpRefused(url)) {
      return errorResponse(new HttpError(403, "HTTPS only"));
    }
    try {
      const res = await handleApi(request, env, pathname);
      // HEAD: same status and headers, no body.
      return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
