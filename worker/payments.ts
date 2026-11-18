// The payment side of the API (ADR-0041): Yoco's signed webhook, the status the result page polls, and the owner's "needs you" list.
// Only a verified webhook confirms an order. The success redirect never does.
import { HttpError, json, readRawText } from "./http";
import { hashKey, ipBucket, limiterSalt, take, type LimiterEnv } from "./limiter-client";
import { orders, type OrdersEnv } from "./orders-client";
import { modeOk, verifyWebhook, type YocoEnv } from "./yoco";

export interface PaymentsEnv extends LimiterEnv, OrdersEnv, YocoEnv {
  ADMIN_PASSWORD?: string;
  LIMITER_SALT?: string;
}

export const WEBHOOK_MAX_BYTES = 64 * 1024;
const REF = /^SB-[A-Z2-9]{6}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Logs one line with only the reference and the outcome. Never the body, the headers, a name, an email or card details. */
function note(outcome: string, ref?: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: "yoco-webhook", outcome, ...(ref ? { ref } : {}), ...extra }));
}

/**
 * POST /api/yoco/webhook. Verify first (nothing touches the Orders object before the signature passes), then:
 * wrong mode or other event type -> 200 and ignored; payment.succeeded -> markPaid (once). Always 200 for anything we
 * understood, so Yoco doesn't retry what can never succeed. Failures of OUR store answer 500 so Yoco retries.
 */
export async function handleWebhook(request: Request, env: PaymentsEnv, nowMs: number = Date.now()): Promise<Response> {
  if (modeOk(env) !== null) throw new HttpError(503, "Not switched on yet");
  const raw = await readRawText(request, WEBHOOK_MAX_BYTES);
  const v = await verifyWebhook(request.headers, raw, env.YOCO_WEBHOOK_SECRET as string, nowMs);
  if (!v.ok) {
    note(`rejected-${v.reason}`);
    if (v.reason === "signature") throw new HttpError(401, "Invalid signature");
    if (v.reason === "secret") throw new HttpError(503, "Not switched on yet");
    throw new HttpError(400, "Invalid request");
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid request");
  }
  if (!isObj(event) || typeof event.type !== "string" || !isObj(event.payload)) throw new HttpError(400, "Invalid request");
  const p = event.payload;

  // A test-mode event can never confirm a live order (and the other way round).
  if (p.mode !== env.YOCO_MODE) {
    note("ignored-mode");
    return json({ ok: true });
  }
  if (event.type !== "payment.succeeded") {
    note("ignored-type");
    return json({ ok: true });
  }

  const metadata = isObj(p.metadata) ? p.metadata : {};
  const checkoutId = typeof metadata.checkoutId === "string" && metadata.checkoutId ? metadata.checkoutId : null;
  // Fallback while Yoco's docs don't list a checkout id on payment events: our own `ref` metadata, if Yoco passes it through.
  const ref = typeof metadata.ref === "string" && REF.test(metadata.ref) ? metadata.ref : null;
  if (typeof p.amount !== "number" || !Number.isInteger(p.amount) || typeof p.currency !== "string" || typeof p.id !== "string" || !p.id) {
    throw new HttpError(400, "Invalid request");
  }
  const webhookId = request.headers.get("webhook-id") as string;

  const result = await orders(env).markPaid({ checkoutId, ref, amountCents: p.amount, currency: p.currency, paymentId: p.id, webhookId });
  switch (result.kind) {
    case "paid":
      note("paid", result.ref, { matchedBy: result.matchedBy });
      break;
    case "duplicate":
      note("duplicate", result.ref);
      break;
    case "mismatch":
      note("mismatch", result.ref); // no email; listed for the owner under /api/admin/orders/attention
      break;
    default:
      // Could be another Yoco integration on her account. Key NAMES only (never values), so the first test run shows what Yoco sends.
      note("unmatched", undefined, { metadataKeys: Object.keys(metadata).slice(0, 10) });
  }
  return json({ ok: true });
}

/** GET /api/order/status?ref=SB-XXXXXX: { status } and nothing else. 60 an hour per IPv4 or IPv6 /64. */
export async function handleStatus(request: Request, env: PaymentsEnv): Promise<Response> {
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  if (!REF.test(ref)) return json({ status: "unknown" });
  let verdict;
  try {
    const key = `status:${await hashKey(ipBucket(request.headers.get("CF-Connecting-IP") ?? "unknown"), limiterSalt(env))}`;
    verdict = await take(env, key, [{ id: "hour", limit: 60, windowSec: 3600 }]);
  } catch {
    throw new HttpError(503, "Please try again in a minute.");
  }
  if (!verdict.ok) throw new HttpError(429, "Please wait a little before checking again.", { "Retry-After": String(Math.min(verdict.retryAfter, 3600)) });
  let status;
  try {
    status = await orders(env).status(ref);
  } catch {
    throw new HttpError(503, "Please try again in a minute.");
  }
  return json({ status });
}

/** GET /api/admin/orders/attention (already behind the admin password): paid orders whose emails failed, and payments that did not match. */
export async function handleAttention(env: PaymentsEnv): Promise<Response> {
  let items;
  try {
    items = await orders(env).attention();
  } catch {
    throw new HttpError(503, "Storage is not responding. Try again in a minute.");
  }
  return json({ count: items.length, items });
}
