// The signed "Cancel my order" link (automatic refunds, founder decision 2026-11-19).
// The Worker signs, the Apps Script only prints the link. A token is `<ref>.<cancelBy>.<signature>`:
//   ref       the order reference (SB-XXXXXX),
//   cancelBy  epoch SECONDS of the first instant self-cancel is refused (the Wednesday cut-off of that order),
//   signature base64url HMAC-SHA256 over `stuffd-cancel-v1|<ref>|<cancelBy>` with the Worker secret CANCEL_LINK_SECRET.
// The token only proves "this link was made for this order". Whether a refund is allowed is decided again, on the server, from the
// stored order and the clock at the moment of the refund (worker/orders-core.ts beginCancel), never from the token alone.
// The link puts the token after a # so it never reaches a server log or a Referer header; the page sends it in a POST body.
// No Cloudflare imports: Node tests bundle this file and run the real code.
import { cutoffInstant, marketCutoffInstant } from "../artifacts/stuffd-bagels/src/collection";
import { sameBytes, siteOrigin, type YocoEnv } from "./yoco";

export interface CancelEnv {
  /** Worker secret, 32+ random characters, set by the founder: `npx wrangler@4.148.0 secret put CANCEL_LINK_SECRET`. Never in git. */
  CANCEL_LINK_SECRET?: string;
}

export const MIN_CANCEL_SECRET = 32;
const REF = /^SB-[A-Z2-9]{6}$/;
const SIG_LEN = 43; // base64url of 32 bytes, no padding
export const TOKEN_SHAPE = /^SB-[A-Z2-9]{6}\.\d{9,12}\.[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

/** True when the secret is present and long enough. Without it no link is made and no cancellation is accepted (fails closed). */
export function cancelReady(env: CancelEnv): boolean {
  const s = env.CANCEL_LINK_SECRET;
  return typeof s === "string" && s.length >= MIN_CANCEL_SECRET;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(secret: string, ref: string, cancelBySec: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`stuffd-cancel-v1|${ref}|${cancelBySec}`)));
}

/** A token for this order, or null when the secret is missing or short, or the inputs are not what we issue. */
export async function makeCancelToken(env: CancelEnv, ref: string, cancelByMs: number): Promise<string | null> {
  if (!cancelReady(env) || !REF.test(ref) || !Number.isFinite(cancelByMs) || cancelByMs <= 0) return null;
  const sec = Math.floor(cancelByMs / 1000);
  return `${ref}.${sec}.${b64url(await sign(env.CANCEL_LINK_SECRET as string, ref, sec))}`;
}

export type TokenResult = { ok: true; ref: string; cancelByMs: number } | { ok: false };

/** Checks shape, then the signature in constant time. Says nothing about WHY a token failed. */
export async function verifyCancelToken(env: CancelEnv, token: unknown): Promise<TokenResult> {
  if (!cancelReady(env) || typeof token !== "string" || token.length > 120 || !TOKEN_SHAPE.test(token)) return { ok: false };
  const [ref, secText, sigText] = token.split(".");
  const sec = Number(secText);
  const got = fromB64url(sigText);
  // Only the one canonical spelling of a signature is accepted (the last base64 character has 2 spare bits that decoding would ignore).
  if (!Number.isSafeInteger(sec) || !got || got.length !== 32 || sigText.length !== SIG_LEN || b64url(got) !== sigText) return { ok: false };
  const expected = await sign(env.CANCEL_LINK_SECRET as string, ref, sec);
  return sameBytes(got, expected) ? { ok: true, ref, cancelByMs: sec * 1000 } : { ok: false };
}

/** The full link for the confirmation email, or null (no secret, or SITE_ORIGIN unusable). The token sits after the #. */
export async function cancelLink(env: CancelEnv & YocoEnv, ref: string, cancelByMs: number | null): Promise<string | null> {
  const origin = siteOrigin(env);
  if (!origin || cancelByMs === null) return null;
  const token = await makeCancelToken(env, ref, cancelByMs);
  return token ? `${origin}/order/cancel#${token}` : null;
}

const SAST_MS = 2 * 3600_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Wednesday 25 Nov at 23:59": the last minute in which cancelling works. `cancelByMs` is the first instant it is refused
 * (the end of the cut-off minute), so the label is one minute earlier. South Africa has no daylight saving: SAST is UTC+2 all year.
 */
export function cancelByLabel(cancelByMs: number): string {
  const d = new Date(cancelByMs - 60_000 + SAST_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} at ${hh}:${mm}`;
}

/**
 * THE place that says when self-cancel stops for an order: the first instant after the Wednesday cut-off before its collection day.
 * For a Saturday order this is the same rule that closes ordering (collection.ts cutoffInstant). Everything downstream (the stored
 * `cancelBy`, the signed link, the refund check, the emails) only ever sees the resulting instant, never a date.
 * SB-20: a market pre-order closes on the Wednesday before the market's FIRST day, whichever day the customer picked
 * (cancelDeadlineMarket, collection.ts marketCutoffInstant).
 */
export function cancelDeadline(collectionIso: string, cutoffTime: string): number {
  return cutoffInstant(collectionIso, cutoffTime);
}

export function cancelDeadlineMarket(marketStartIso: string, cutoffTime: string): number {
  return marketCutoffInstant(marketStartIso, cutoffTime);
}
