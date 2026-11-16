// Admin password check and lockout (ADR-0028 "Password and lockout", acceptance checks 3, 4, 18).
import { HttpError } from "./http";
import { secondsToSastMidnight, sastToday } from "./store";

const MAX_IP_FAILS = 5;
const IP_LOCK_SECONDS = 900;
const MAX_DAY_FAILS = 100;
const MAX_PASSWORD_LENGTH = 256;
const enc = new TextEncoder();

const sha256 = (s: string) => crypto.subtle.digest("SHA-256", enc.encode(s));

/** SHA-256 both sides so the lengths match, then a constant-time compare of the two digests. */
async function passwordMatches(given: string | null, secret: string): Promise<boolean> {
  if (!given || given.length > MAX_PASSWORD_LENGTH) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(secret)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Keyed hash of the IP, so the raw address is never stored (and can't be brute-forced from KV). */
async function hashIp(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(ip)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function count(kv: KVNamespace, key: string): Promise<number> {
  const n = Number(await kv.get(key));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Throws HttpError unless the request carries the right x-admin-password.
 * Lockout writes to KV only on failed logins, and stops writing once locked, so an attack
 * cannot use up the daily KV write allowance.
 */
export async function requireAdmin(request: Request, env: { ADMIN_PASSWORD?: string; STUFFD_KV?: KVNamespace }): Promise<void> {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) throw new HttpError(500, "Server error"); // not configured: say nothing more

  const kv = env.STUFFD_KV;
  const ipKey = `fail:${await hashIp(request.headers.get("CF-Connecting-IP") ?? "unknown", secret)}`;
  const dayKey = `fail:day:${sastToday()}`;

  let ipFails = 0;
  let dayFails = 0;
  if (kv) {
    try {
      [ipFails, dayFails] = await Promise.all([count(kv, ipKey), count(kv, dayKey)]);
    } catch {
      // KV hiccup: carry on to the password check rather than locking the owner out.
    }
  }
  if (dayFails >= MAX_DAY_FAILS) {
    throw new HttpError(429, "Too many tries. Try again tomorrow.", { "Retry-After": String(secondsToSastMidnight()) });
  }
  if (ipFails >= MAX_IP_FAILS) {
    throw new HttpError(429, "Too many tries. Wait 15 minutes and try again.", { "Retry-After": String(IP_LOCK_SECONDS) });
  }

  if (await passwordMatches(request.headers.get("x-admin-password"), secret)) return;

  if (kv) {
    try {
      await Promise.all([
        kv.put(ipKey, String(ipFails + 1), { expirationTtl: IP_LOCK_SECONDS }),
        kv.put(dayKey, String(dayFails + 1), { expirationTtl: 2 * 86400 }),
      ]);
    } catch {
      // Could not record the failure; still refuse the request.
    }
  }
  throw new HttpError(401, "Invalid password");
}
