// Talking to the Limiter Durable Object, plus the key helpers. No Cloudflare imports here.
import type { Rule, Verdict } from "./limiter-core";

export type { Rule, Verdict };

interface LimiterStub {
  take(rules: Rule[]): Promise<Verdict>;
  refund(ids: string[]): Promise<void>;
}

export interface LimiterEnv {
  LIMITER?: DurableObjectNamespace;
}

const enc = new TextEncoder();

function stub(env: LimiterEnv, key: string): LimiterStub {
  if (!env.LIMITER) throw new Error("limiter not configured");
  return env.LIMITER.get(env.LIMITER.idFromName(key)) as unknown as LimiterStub;
}

/** Takes one slot from each rule under this key (all or nothing). Throws if the store is unreachable: callers fail closed. */
export function take(env: LimiterEnv, key: string, rules: Rule[]): Promise<Verdict> {
  return stub(env, key).take(rules);
}

/** Best effort: gives slots back. A failure here only means the person stays counted. */
export async function refund(env: LimiterEnv, key: string, ids: string[]): Promise<void> {
  try {
    await stub(env, key).refund(ids);
  } catch {
    // ignore
  }
}

/**
 * The part of an address that identifies one network: IPv4 as is, IPv6 cut to its /64 (one home or
 * phone connection gets a whole /64, so keying on the full address would give an attacker 2^64 identities).
 */
export function ipBucket(raw: string): string {
  const s = raw.trim().toLowerCase().split("%")[0];
  if (!s.includes(":")) return s; // IPv4, or "unknown"
  const mapped = /^(?:0{0,4}:){2,5}ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (mapped) return mapped[1];
  let t = s;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return s;
    t = t.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = t.split("::");
  if (halves.length > 2) return s;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 1) return s;
    groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  } else groups = left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":") + "::/64";
}

/** Keyed hash (HMAC-SHA-256, first 16 bytes as hex), so raw addresses and emails never become object names. */
export async function hashKey(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The same mailbox written different ways counts once: case, "+tag", and dots in Gmail addresses. */
export function normaliseEmail(address: string): string {
  const [local, domain = ""] = address.trim().toLowerCase().split("@");
  let l = local.split("+")[0];
  let d = domain;
  if (d === "googlemail.com") d = "gmail.com";
  if (d === "gmail.com") l = l.replace(/\./g, "");
  return `${l}@${d}`;
}
