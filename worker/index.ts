// Stuff'd Bagels Worker (ADR-0028, revised to Workers static assets).
// Only /api and /api/* reach this code (wrangler.jsonc: assets.run_worker_first). Everything
// else is served straight from the static assets, so pages and images stay free requests.
import { requireAdmin } from "./auth";
import { HttpError, errorResponse, json, readJsonObject } from "./http";
import {
  LIMITS,
  parseAvailabilityInput,
  parseEventInput,
  publicAvailability,
  publicEvents,
  readAvailability,
  readEvents,
  withToday,
  writeAvailability,
  writeEvents,
} from "./store";

export interface Env {
  ASSETS: Fetcher;
  STUFFD_KV?: KVNamespace;
  ADMIN_PASSWORD?: string;
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
    const next = parseAvailabilityInput(await readJsonObject(request));
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
    return json({ ok: true, id: newId });
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

  throw new HttpError(404, "Not found");
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
  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/api" && !pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const res = await handleApi(request, env, pathname);
      // HEAD: same status and headers, no body.
      return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
