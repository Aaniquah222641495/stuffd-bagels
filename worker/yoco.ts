// Yoco Checkout API: create a checkout, verify a webhook, and decide whether payments are switched on (ADR-0041).
// Facts checked on developer.yoco.com on 2026-11-18: POST https://payments.yoco.com/api/checkouts (Bearer secret key, amount
// in cents, currency ZAR, Idempotency-Key, expiresAt 30 minutes to 70 days); webhook headers webhook-id / webhook-timestamp /
// webhook-signature, signed content `${id}.${timestamp}.${rawBody}`, key = base64 of the secret after `whsec_`, HMAC-SHA256, base64.
// No Cloudflare imports: Node tests bundle this file and run the real code.

export interface YocoEnv {
  YOCO_SECRET_KEY?: string;
  YOCO_WEBHOOK_SECRET?: string;
  /** "test" on the preview, "live" in production. Plain var, not a secret. */
  YOCO_MODE?: string;
  /** The public origin Yoco sends the customer back to, e.g. https://stuffdbagels.co.za. Plain var. */
  SITE_ORIGIN?: string;
  /** Test only: honoured only when it starts with http://127.0.0.1 (a local fake Yoco). Never set in wrangler.jsonc. */
  YOCO_API_BASE?: string;
}

const YOCO_BASE = "https://payments.yoco.com";
const enc = new TextEncoder();

export type NotReady = "mode" | "secret" | "webhook-secret" | "prefix" | "origin";

/** Null when Yoco payments can be switched on; otherwise why not. The Worker answers 503 "not switched on yet". */
export function modeOk(env: YocoEnv): NotReady | null {
  const mode = env.YOCO_MODE;
  if (mode !== "test" && mode !== "live") return "mode";
  const key = env.YOCO_SECRET_KEY;
  if (!key || key.length < 12) return "secret";
  if (!env.YOCO_WEBHOOK_SECRET || !env.YOCO_WEBHOOK_SECRET.startsWith("whsec_")) return "webhook-secret";
  // A live key on the preview, or a test key in production, must never work.
  if (!key.startsWith(mode === "live" ? "sk_live_" : "sk_test_")) return "prefix";
  if (!siteOrigin(env)) return "origin";
  return null;
}

export function siteOrigin(env: YocoEnv): string | null {
  try {
    const u = new URL(env.SITE_ORIGIN ?? "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The API base: Yoco, unless a LOCAL fake is named (only http://127.0.0.1 is honoured, so this can't redirect real keys elsewhere). */
function apiBase(env: YocoEnv): string {
  const b = env.YOCO_API_BASE;
  if (typeof b !== "string" || !b.startsWith("http://127.0.0.1")) return YOCO_BASE;
  try {
    const u = new URL(b);
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && !u.username ? u.origin : YOCO_BASE; // not "127.0.0.1.evil.example"
  } catch {
    return YOCO_BASE;
  }
}

export class YocoError extends Error {
  constructor(public reason: "network" | "status" | "response" | "redirect" | "mode" | "refund", public status = 0) {
    super(`yoco ${reason}${status ? " " + status : ""}`);
  }
}

export interface CheckoutInput {
  ref: string;
  /** The browser's per-press UUID: sent as Idempotency-Key so a retry returns the first checkout. */
  attemptId: string;
  amountCents: number;
  /** Display only; the sum of qty x unitCents must equal amountCents. */
  lines: { name: string; qty: number; unitCents: number }[];
  /** Epoch ms, injected so tests can fix the clock. */
  now: number;
}

/** True for https://yoco.com or https://<anything>.yoco.com, or (local fake only) the fake's own origin. */
function redirectOk(raw: unknown, env: YocoEnv): raw is string {
  if (typeof raw !== "string") return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (apiBase(env) !== YOCO_BASE) return u.origin === new URL(apiBase(env)).origin; // local fake
  return u.protocol === "https:" && (u.hostname === "yoco.com" || u.hostname.endsWith(".yoco.com")) && !u.username && !u.password;
}

/**
 * Creates the Yoco checkout for one order. Sends no personal data: only the amount, the display lines and our reference.
 * Throws YocoError on any failure (the caller drops the pending row and gives the rate-limit slots back).
 */
export async function createCheckout(env: YocoEnv, input: CheckoutInput): Promise<{ id: string; redirectUrl: string }> {
  const origin = siteOrigin(env);
  if (!origin || !env.YOCO_SECRET_KEY) throw new YocoError("mode");
  const back = (r: "success" | "cancel" | "failure") => `${origin}/order/result?r=${r}&ref=${encodeURIComponent(input.ref)}`;
  const body = {
    amount: input.amountCents,
    currency: "ZAR",
    externalId: input.ref,
    clientReferenceId: input.ref,
    metadata: { ref: input.ref },
    lineItems: input.lines.map((l) => ({ displayName: l.name, quantity: l.qty, pricingDetails: { price: l.unitCents } })),
    successUrl: back("success"),
    cancelUrl: back("cancel"),
    failureUrl: back("failure"),
    // One minute over Yoco's 30-minute minimum, UTC "Z" form, so a little clock skew can't make Yoco answer 400.
    expiresAt: new Date(input.now + 31 * 60_000).toISOString(),
  };
  let res: Response;
  try {
    res = await fetch(`${apiBase(env)}/api/checkouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.YOCO_SECRET_KEY}`, "Idempotency-Key": input.attemptId },
      body: JSON.stringify(body),
      redirect: "manual", // a redirect from the API is never followed
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new YocoError("network");
  }
  if (res.status < 200 || res.status > 299) throw new YocoError("status", res.status);
  const j = await res.json().then(
    (v) => v as { id?: unknown; redirectUrl?: unknown; processingMode?: unknown } | null,
    () => null,
  );
  if (!j || typeof j.id !== "string" || j.id.length < 4 || j.id.length > 100 || !/^[A-Za-z0-9_\-]+$/.test(j.id)) throw new YocoError("response");
  if (!redirectOk(j.redirectUrl, env)) throw new YocoError("redirect");
  // Belt and braces next to the key prefix check: a checkout made in the other mode is never used.
  if (typeof j.processingMode === "string" && j.processingMode !== env.YOCO_MODE) throw new YocoError("mode");
  return { id: j.id, redirectUrl: j.redirectUrl as string };
}

export interface RefundResult {
  refundId: string;
  /** Yoco's word for it. `pending` is still a refund Yoco has accepted: it finishes on its own. */
  status: "succeeded" | "pending";
}

/**
 * Refunds a checkout IN FULL (empty body: Yoco's default is the whole amount, so no amount ever comes from us or the browser).
 * Checked on developer.yoco.com 2026-11-20 and by hand on live order SB-N9SE2N: POST /api/checkouts/{id}/refund, Bearer secret key,
 * Idempotency-Key, answer { refundId, status: "succeeded" | "pending" }. Live checkouts only (a test checkout can't be refunded).
 * The key is `refund-<ref>`, so a repeat of the same call (a double click, a retry after a timeout) is answered with the first result
 * instead of refunding twice. Anything but a 2xx with a recognised status is a YocoError: the caller must never call that a refund.
 */
export async function refundCheckout(env: YocoEnv, a: { checkoutId: string; ref: string }): Promise<RefundResult> {
  if (modeOk(env) !== null || !env.YOCO_SECRET_KEY) throw new YocoError("mode");
  if (!/^[A-Za-z0-9_\-]{4,100}$/.test(a.checkoutId) || !/^SB-[A-Z2-9]{6}$/.test(a.ref)) throw new YocoError("refund");
  let res: Response;
  try {
    res = await fetch(`${apiBase(env)}/api/checkouts/${a.checkoutId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.YOCO_SECRET_KEY}`, "Idempotency-Key": `refund-${a.ref}` },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new YocoError("network"); // the outcome is UNKNOWN (the refund may have gone through): the caller treats it as "check Yoco"
  }
  if (res.status < 200 || res.status > 299) throw new YocoError("status", res.status);
  const j = await res.json().then(
    (v) => v as { refundId?: unknown; status?: unknown } | null,
    () => null,
  );
  if (!j || typeof j.refundId !== "string" || !/^[A-Za-z0-9_\-]{4,100}$/.test(j.refundId)) throw new YocoError("response");
  if (j.status !== "succeeded" && j.status !== "pending") throw new YocoError("response");
  return { refundId: j.refundId, status: j.status };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "headers" | "timestamp" | "secret" | "signature" };

/** Constant-time equality of two byte arrays of the same length (workerd's timingSafeEqual when present, else an XOR loop for Node). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const tse = (crypto.subtle as unknown as { timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean }).timingSafeEqual;
  if (typeof tse === "function") return tse.call(crypto.subtle, a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function fromBase64(s: string): Uint8Array | null {
  if (s.length === 0 || s.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export const WEBHOOK_TOLERANCE_SECONDS = 180;

/**
 * Checks a Yoco webhook. `rawBody` is the exact text received (never re-serialised JSON). `nowMs` is injected for tests.
 * Order of checks: headers present, timestamp within 180 s either side, then the signature (any `v1,` entry may match).
 */
export async function verifyWebhook(headers: Headers, rawBody: string, secret: string, nowMs: number): Promise<VerifyResult> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig || id.length > 200) return { ok: false, reason: "headers" };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: "timestamp" };
  if (Math.abs(nowMs / 1000 - Number(ts)) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp" };

  if (!secret.startsWith("whsec_")) return { ok: false, reason: "secret" };
  const keyBytes = fromBase64(secret.slice("whsec_".length));
  if (!keyBytes) return { ok: false, reason: "secret" };
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${rawBody}`)));

  // Look at every entry (no early exit), skip anything that isn't v1 or isn't a 32-byte value.
  let match = false;
  for (const entry of sig.split(" ")) {
    if (!entry.startsWith("v1,")) continue;
    const got = fromBase64(entry.slice(3));
    if (got && got.length === expected.length && sameBytes(got, expected)) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: "signature" };
}
