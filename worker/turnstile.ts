// Cloudflare Turnstile server check (go-live gate D-SB-7). Every order and booking must carry a fresh Turnstile token, verified here
// BEFORE a Yoco checkout is created or an Apps Script email is sent, so a bot cannot open checkouts or use up the 40-a-day email cap.
// Facts checked on developers.cloudflare.com on 2026-11-19: siteverify is POST https://challenges.cloudflare.com/turnstile/v0/siteverify
// (secret, response, optional remoteip, optional idempotency_key); the answer has success, error-codes, hostname, action; a token is
// valid for 300 seconds and single use (a second check says timeout-or-duplicate); tokens are at most 2048 characters. Cloudflare's
// documented test keys: site key 1x00000000000000000000AA and secret 1x0000000000000000000000000000000AA always pass (they accept only
// the token XXXX.DUMMY.TOKEN.XXXX and report hostname example.com with no action).
// No Cloudflare imports: Node tests bundle this file and run the real code.
import { HttpError } from "./http";

export interface TurnstileEnv {
  /** "production" (top level of wrangler.jsonc), "preview" or "development". Anything else, including unset, counts as production. */
  APP_ENV?: string;
  /** Public widget key (plain var, not a secret). */
  TURNSTILE_SITE_KEY?: string;
  /** Worker secret, never committed: `npx wrangler@4.148.0 secret put TURNSTILE_SECRET_KEY`. */
  TURNSTILE_SECRET_KEY?: string;
  /** The public origin; the hostname Turnstile reports must be this host (or its www. form). */
  SITE_ORIGIN?: string;
  /** Test only: honoured only when it starts with http://127.0.0.1 (a local fake siteverify). Never set in wrangler.jsonc. */
  TURNSTILE_API_BASE?: string;
}

export const TEST_SITE_KEY = "1x00000000000000000000AA";
export const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const MAX_TOKEN = 2048;
export type TurnstileAction = "order" | "booking" | "cancel";

const MSG_MISSING = "Please wait for the security check to finish, then try again.";
const MSG_FAILED = "We couldn't confirm the security check. Please try again.";
const MSG_DOWN = "We can't take this right now. Please try again in a minute.";

/** Cloudflare's documented test keys start 1x/2x/3x followed by zeros. They must never be accepted in production. */
function isTestKey(k: string): boolean {
  return /^[123]x0{10}/.test(k);
}

/** Only the preview and local development may fall back to the documented always-pass test keys. Production never does. */
function testKeysAllowed(env: TurnstileEnv): boolean {
  return env.APP_ENV === "preview" || env.APP_ENV === "development";
}

/** The public site key for the browser, or "" when Turnstile is not set up (the forms then refuse, see assertTurnstileReady). */
export function turnstileSiteKey(env: TurnstileEnv): string {
  const key = (env.TURNSTILE_SITE_KEY ?? "").trim();
  if (testKeysAllowed(env)) return key || TEST_SITE_KEY;
  return key && !isTestKey(key) ? key : "";
}

function secretFor(env: TurnstileEnv): string {
  const secret = (env.TURNSTILE_SECRET_KEY ?? "").trim();
  return secret || (testKeysAllowed(env) ? TEST_SECRET_KEY : "");
}

/**
 * The 503 cases: no secret, or a documented test secret, in production. Logged loudly so a forgotten secret shows up in `wrangler tail`.
 * Nothing is sent to anyone and nothing is counted while this fails.
 */
export function assertTurnstileReady(env: TurnstileEnv): string {
  const secret = secretFor(env);
  if (!secret) {
    console.error("turnstile: TURNSTILE_SECRET_KEY is NOT SET in production, so every order and booking is refused. Run: npx wrangler@4.148.0 secret put TURNSTILE_SECRET_KEY");
    throw new HttpError(503, MSG_DOWN);
  }
  if (!testKeysAllowed(env) && isTestKey(secret)) {
    console.error("turnstile: TURNSTILE_SECRET_KEY is one of Cloudflare's documented TEST secrets, which is refused in production. Set the real secret: npx wrangler@4.148.0 secret put TURNSTILE_SECRET_KEY");
    throw new HttpError(503, MSG_DOWN);
  }
  if (!testKeysAllowed(env) && !allowedHostnames(env)) {
    console.error("turnstile: SITE_ORIGIN is missing or not a valid URL in production, so the token's hostname cannot be checked and every order and booking is refused. Set SITE_ORIGIN in wrangler.jsonc vars.");
    throw new HttpError(503, MSG_DOWN);
  }
  return secret;
}

/** Cheap checks before any storage is touched: Turnstile is configured, and the request carries a token of a sane shape. */
export function precheckTurnstile(env: TurnstileEnv, token: unknown): string {
  assertTurnstileReady(env);
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN) throw new HttpError(400, MSG_MISSING);
  return token;
}

function allowedHostnames(env: TurnstileEnv): string[] | null {
  try {
    const host = new URL(env.SITE_ORIGIN ?? "").hostname.toLowerCase();
    return host ? [host, host.startsWith("www.") ? host.slice(4) : `www.${host}`] : null;
  } catch {
    return null;
  }
}

function apiUrl(env: TurnstileEnv): string {
  const base = env.TURNSTILE_API_BASE;
  return typeof base === "string" && base.startsWith("http://127.0.0.1") ? `${base.replace(/\/+$/, "")}/turnstile/v0/siteverify` : SITEVERIFY;
}

interface Verdict {
  success?: unknown;
  "error-codes"?: unknown;
  hostname?: unknown;
  action?: unknown;
}

/** One call to siteverify. null when Cloudflare can't be reached or answers with something that isn't JSON (the caller fails closed). */
async function siteverify(env: TurnstileEnv, form: URLSearchParams): Promise<Verdict | null> {
  try {
    const res = await fetch(apiUrl(env), { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error("turnstile: siteverify answered", res.status);
      return null;
    }
    const data: unknown = await res.json();
    return data && typeof data === "object" ? (data as Verdict) : null;
  } catch (err) {
    console.error("turnstile: siteverify unreachable", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

/**
 * Asks Cloudflare whether this token is good (once). Throws an HttpError otherwise, failing CLOSED:
 * 400 no token, 403 bad / spent / wrong-site token, 503 not configured, rejected secret, or Cloudflare unreachable.
 * Logs reasons (Cloudflare's error codes only), never the token, the secret or anything about the customer.
 */
export async function verifyTurnstile(request: Request, env: TurnstileEnv, token: unknown, action: TurnstileAction): Promise<void> {
  const secret = assertTurnstileReady(env);
  const response = precheckTurnstile(env, token);
  const form = new URLSearchParams({ secret, response });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);

  const result = await siteverify(env, form);
  if (!result) throw new HttpError(503, MSG_DOWN);

  if (result.success !== true) {
    const codes = (Array.isArray(result["error-codes"]) ? result["error-codes"] : []).filter((c): c is string => typeof c === "string" && /^[a-z-]{1,60}$/.test(c));
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) {
      console.error("turnstile: Cloudflare REJECTED TURNSTILE_SECRET_KEY (", codes.join(","), "). Wrong or rotated secret: orders and bookings are refused until it is fixed.");
      throw new HttpError(503, MSG_DOWN);
    }
    if (codes.includes("internal-error")) {
      console.error("turnstile: Cloudflare internal-error");
      throw new HttpError(503, MSG_DOWN);
    }
    console.warn("turnstile: refused", action, codes.join(",") || "no-code");
    throw new HttpError(403, MSG_FAILED);
  }

  // A test secret reports hostname example.com and no action, so these two checks only apply to real keys.
  if (!isTestKey(secret)) {
    const hosts = allowedHostnames(env);
    if (hosts && !(typeof result.hostname === "string" && hosts.includes(result.hostname.toLowerCase()))) {
      console.warn("turnstile: refused", action, "hostname-mismatch");
      throw new HttpError(403, MSG_FAILED);
    }
    if (result.action !== action) {
      console.warn("turnstile: refused", action, "action-mismatch");
      throw new HttpError(403, MSG_FAILED);
    }
  }
}
