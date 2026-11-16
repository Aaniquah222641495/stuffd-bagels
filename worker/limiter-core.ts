// Fixed-window counters, the logic only (no Cloudflare imports, so Node tests can run it).
// worker/limiter.ts wraps this in a Durable Object so every check for one key is serialised:
// that is what makes the admin lockout and the form limits hold under parallel requests.

export interface Rule {
  /** Short name of this counter within the key, e.g. "15m" or "day". */
  id: string;
  limit: number;
  /** Window length in seconds, counted from the first hit in that window. */
  windowSec: number;
}

export interface Verdict {
  ok: boolean;
  /** Seconds until the blocking window ends (0 when ok). */
  retryAfter: number;
}

export interface Row {
  count: number;
  resetAt: number;
}

export interface RowStore {
  get(id: string): Row | undefined;
  put(id: string, row: Row): void;
}

/**
 * Takes one slot from every rule, or none of them. Synchronous on purpose: inside a Durable Object
 * nothing else can run between the read and the write.
 */
export function takeRules(store: RowStore, rules: Rule[], now: number): Verdict {
  const live = rules.map((r) => {
    const row = store.get(r.id);
    return { rule: r, row: row && row.resetAt > now ? row : { count: 0, resetAt: now + r.windowSec * 1000 } };
  });
  let retry = 0;
  for (const { rule, row } of live) {
    if (row.count >= rule.limit) retry = Math.max(retry, Math.ceil((row.resetAt - now) / 1000));
  }
  if (retry > 0) return { ok: false, retryAfter: retry };
  for (const { rule, row } of live) store.put(rule.id, { count: row.count + 1, resetAt: row.resetAt });
  return { ok: true, retryAfter: 0 };
}

/** Gives a slot back (a correct password is not a failure). Never goes below zero. */
export function refundRules(store: RowStore, ids: string[], now: number): void {
  for (const id of ids) {
    const row = store.get(id);
    if (row && row.resetAt > now && row.count > 0) store.put(id, { count: row.count - 1, resetAt: row.resetAt });
  }
}
