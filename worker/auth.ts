// Admin password check and lockout (ADR-0028 "Password and lockout", acceptance checks 3, 4, 18).
import { HttpError } from "./http";
import { hashKey, ipBucket, refund, take, type LimiterEnv, type Rule } from "./limiter-client";
import { secondsToSastMidnight } from "./store";

// Lockout (ADR-0028, M2 of the 2026-11-16 re-test): 5 wrong passwords per 15 minutes, and 30 per day, for each
// client network (IPv4 address or IPv6 /64). There is no all-visitors cap, so an attacker cannot lock the owner out
// from another network. The counter lives in a Durable Object (worker/limiter.ts), which is strongly consistent.
export const ADMIN_MAX_FAILS = 5;
export const ADMIN_LOCK_SECONDS = 900;
export const ADMIN_MAX_FAILS_PER_DAY = 30;
const MAX_PASSWORD_LENGTH = 256;
const enc = new TextEncoder();

const sha256 = (s: string) => crypto.subtle.digest("SHA-256", enc.encode(s));

/** SHA-256 both sides so the lengths match, then a constant-time compare of the two digests. */
async function passwordMatches(given: string | null, secret: string): Promise<boolean> {
  if (!given || given.length > MAX_PASSWORD_LENGTH) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(secret)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Throws HttpError unless the request carries the right x-admin-password.
 * A slot is taken BEFORE the password is checked (all-or-nothing, inside the Durable Object), and given back if
 * the password is right. So 12 parallel wrong guesses use 5 slots and the other 7 are refused with 429.
 * If the counter cannot be reached the request is refused (503), never let through.
 */
export async function requireAdmin(request: Request, env: LimiterEnv & { ADMIN_PASSWORD?: string }): Promise<void> {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) throw new HttpError(500, "Server error"); // not configured: say nothing more

  const key = `admin:${await hashKey(ipBucket(request.headers.get("CF-Connecting-IP") ?? "unknown"), secret)}`;
  const ids = ["15m", "day"];
  const rules: Rule[] = [
    { id: ids[0], limit: ADMIN_MAX_FAILS, windowSec: ADMIN_LOCK_SECONDS },
    { id: ids[1], limit: ADMIN_MAX_FAILS_PER_DAY, windowSec: secondsToSastMidnight() },
  ];
  let verdict;
  try {
    verdict = await take(env, key, rules);
  } catch {
    throw new HttpError(503, "Could not check the login just now. Try again in a minute.");
  }
  if (!verdict.ok) {
    const today = verdict.retryAfter > ADMIN_LOCK_SECONDS;
    throw new HttpError(429, today ? "Too many tries. Try again tomorrow." : "Too many tries. Wait 15 minutes and try again.", {
      "Retry-After": String(verdict.retryAfter),
    });
  }
  if (await passwordMatches(request.headers.get("x-admin-password"), secret)) {
    await refund(env, key, ids);
    return;
  }
  throw new HttpError(401, "Invalid password");
}
