// Pending and paid orders: the state machine and retention rules, no Cloudflare imports (so Node tests can run it).
// worker/orders.ts wraps OrdersService in a SQLite Durable Object (one instance), which is what makes
// "pending -> paid" happen exactly once: the object handles one request at a time and every method here is synchronous
// up to its single store write. ADR-0041.
//
// Statuses: creating -> pending -> paid -> confirmed
//           pending -> expired (the checkout's own 30 minutes ran out; worked out from the clock, no Yoco call)
//           expired -> paid (a late payment is final, per Yoco)
//           paid -> email_failed (after the last email retry)
//           mismatch (a verified payment that doesn't match the order: no email, kept for the owner)

export type OrderStatus = "creating" | "pending" | "expired" | "paid" | "confirmed" | "email_failed" | "mismatch";

export interface OrderRow {
  ref: string;
  attemptId: string;
  contentHash: string;
  checkoutId: string | null;
  redirectUrl: string | null;
  amountCents: number;
  status: OrderStatus;
  /** The parsed order as JSON (name, phone, email, items, pickup, note). NULL once the emails have been accepted. */
  orderJson: string | null;
  paymentId: string | null;
  lastWebhookId: string | null;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  emailTries: number;
  nextTryAt: number | null;
  deleteAt: number | null;
}

export interface OrderStore {
  get(ref: string): OrderRow | undefined;
  byAttempt(attemptId: string): OrderRow | undefined;
  byCheckout(checkoutId: string): OrderRow | undefined;
  /** Insert or replace the row with this ref. */
  put(row: OrderRow): void;
  remove(ref: string): void;
  all(): OrderRow[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RULES = {
  /** The Yoco checkout lives this long (Yoco's own minimum is 30 minutes; the Worker asks for 31 so clock skew can't cause a 400). */
  unpaidMs: 30 * MIN,
  /** A row that never got a checkout is dropped after this. */
  creatingMs: 5 * MIN,
  /** Unpaid and expired rows are deleted this long after creation (covers Yoco's ~28 h retry window for a late payment). */
  unpaidKeepMs: 48 * HOUR,
  /** Confirmed stubs, and email_failed / mismatch rows with their details, are deleted this long after. */
  confirmedKeepMs: 7 * DAY,
  /** Wait before email attempt number 2, 3, ...; the first attempt is immediate. After the last wait fails: email_failed. */
  emailRetryMs: [1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR],
};

/** SHA-256 of the canonical order, so a retry of the same press can be told apart from a changed cart. */
export async function contentHash(o: {
  items: { name: string; qty: number }[];
  pickupId: string;
  pickupDate: string;
  pickupTime: string;
  name: string;
  phone: string;
  email: string;
  note: string;
}): Promise<string> {
  const canon = JSON.stringify([
    [...o.items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((i) => [i.name, i.qty]),
    o.pickupId, o.pickupDate, o.pickupTime, o.name, o.phone, o.email, o.note,
  ]);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type BeginResult =
  | { kind: "new"; ref: string }
  | { kind: "existing"; ref: string; redirectUrl: string; amountCents: number }
  | { kind: "changed" }
  | { kind: "expired" }
  | { kind: "busy" }
  | { kind: "paid" };

export type MarkPaidResult =
  | { kind: "paid"; ref: string; matchedBy: "checkoutId" | "ref" }
  | { kind: "duplicate"; ref: string }
  | { kind: "mismatch"; ref: string }
  | { kind: "unknown" };

export type PublicStatus = "pending" | "paid" | "expired" | "unknown";

export interface AttentionItem {
  ref: string;
  status: "email_failed" | "mismatch";
  amountCents: number;
  checkoutId: string | null;
  paymentId: string | null;
  paidAt: number | null;
  /** The order details (name, phone, email, items, pickup) so the owner can act. Present for 7 days. */
  order: unknown;
}

export class OrdersService {
  constructor(private store: OrderStore, private clock: () => number = Date.now) {}

  /** What an attempt id already stands for, without writing anything. Used before the rate limit. */
  lookup(attemptId: string, hash: string): BeginResult | { kind: "none" } {
    const row = this.store.byAttempt(attemptId);
    if (!row) return { kind: "none" };
    return this.existing(row, hash);
  }

  private existing(row: OrderRow, hash: string): BeginResult {
    if (row.contentHash !== hash) return { kind: "changed" };
    switch (row.status) {
      case "creating":
        return { kind: "busy" };
      case "pending":
        if (row.expiresAt <= this.clock() || !row.redirectUrl) return { kind: "expired" };
        return { kind: "existing", ref: row.ref, redirectUrl: row.redirectUrl, amountCents: row.amountCents };
      case "expired":
        return { kind: "expired" };
      default:
        return { kind: "paid" };
    }
  }

  /** Writes the row as `creating`, unless this attempt id is already known (then says what it stands for). */
  begin(a: { attemptId: string; contentHash: string; ref: string; amountCents: number; orderJson: string }): BeginResult {
    const row = this.store.byAttempt(a.attemptId);
    if (row) return this.existing(row, a.contentHash);
    if (this.store.get(a.ref)) throw new Error("ref collision");
    const now = this.clock();
    this.store.put({
      ref: a.ref, attemptId: a.attemptId, contentHash: a.contentHash, checkoutId: null, redirectUrl: null,
      amountCents: a.amountCents, status: "creating", orderJson: a.orderJson, paymentId: null, lastWebhookId: null,
      createdAt: now, expiresAt: now + RULES.unpaidMs, paidAt: null, emailTries: 0, nextTryAt: null,
      deleteAt: now + RULES.creatingMs,
    });
    return { kind: "new", ref: a.ref };
  }

  /** creating -> pending, once Yoco has made the checkout. False if the row is gone or no longer `creating`. */
  attach(a: { ref: string; checkoutId: string; redirectUrl: string }): boolean {
    const row = this.store.get(a.ref);
    if (!row || row.status !== "creating") return false;
    const now = this.clock();
    this.store.put({
      ...row, status: "pending", checkoutId: a.checkoutId, redirectUrl: a.redirectUrl,
      expiresAt: now + RULES.unpaidMs, deleteAt: row.createdAt + RULES.unpaidKeepMs,
    });
    return true;
  }

  /** Forgets a row that never got a checkout (Yoco said no). Only `creating` rows can be dropped. */
  drop(ref: string): void {
    const row = this.store.get(ref);
    if (row && row.status === "creating") this.store.remove(ref);
  }

  /**
   * A VERIFIED payment.succeeded arrived. Finds the order by Yoco's checkout id (or, if Yoco didn't send one, by our own
   * `ref` metadata), checks amount and currency, and moves it to `paid` once. Everything that follows a replay or a
   * duplicate delivery is `duplicate`: no second email.
   */
  markPaid(a: { checkoutId: string | null; ref: string | null; amountCents: number; currency: string; paymentId: string; webhookId: string }): MarkPaidResult {
    let row = a.checkoutId ? this.store.byCheckout(a.checkoutId) : undefined;
    let matchedBy: "checkoutId" | "ref" = "checkoutId";
    if (!row && a.ref) {
      row = this.store.get(a.ref);
      matchedBy = "ref";
    }
    if (!row) return { kind: "unknown" };
    const now = this.clock();
    if (row.status === "paid" || row.status === "confirmed" || row.status === "email_failed" || row.status === "mismatch") {
      return { kind: "duplicate", ref: row.ref };
    }
    // pending, expired (a late payment is final) or creating (found by ref after a crash between Yoco and `attach`).
    if (a.currency !== "ZAR" || a.amountCents !== row.amountCents) {
      this.store.put({ ...row, status: "mismatch", paymentId: a.paymentId, lastWebhookId: a.webhookId, paidAt: now, nextTryAt: null, deleteAt: now + RULES.confirmedKeepMs });
      return { kind: "mismatch", ref: row.ref };
    }
    this.store.put({
      ...row, status: "paid", paymentId: a.paymentId, lastWebhookId: a.webhookId, paidAt: now,
      emailTries: 0, nextTryAt: now, deleteAt: null,
    });
    return { kind: "paid", ref: row.ref, matchedBy };
  }

  /** What the browser may know. Never any personal data. A mismatch reads as `pending`: we never say "confirmed" for it. */
  status(ref: string): PublicStatus {
    const row = this.store.get(ref);
    if (!row) return "unknown";
    switch (row.status) {
      case "paid":
      case "confirmed":
      case "email_failed":
        return "paid";
      case "expired":
        return "expired";
      case "pending":
        return row.expiresAt <= this.clock() ? "expired" : "pending";
      default:
        return "pending"; // creating, mismatch
    }
  }

  /** Paid orders whose emails could not be sent, and verified payments that did not match, with their details. */
  attention(): AttentionItem[] {
    return this.store
      .all()
      .filter((r) => r.status === "email_failed" || r.status === "mismatch")
      .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))
      .map((r) => {
        let order: unknown = null;
        try {
          order = r.orderJson ? JSON.parse(r.orderJson) : null;
        } catch {
          // leave null
        }
        return { ref: r.ref, status: r.status as "email_failed" | "mismatch", amountCents: r.amountCents, checkoutId: r.checkoutId, paymentId: r.paymentId, paidAt: r.paidAt, order };
      });
  }

  /** Emails accepted by the script: drop the personal data, keep a stub for 7 days. */
  emailDone(ref: string): void {
    const row = this.store.get(ref);
    if (!row || row.status !== "paid") return;
    this.store.put({ ...row, status: "confirmed", orderJson: null, nextTryAt: null, deleteAt: this.clock() + RULES.confirmedKeepMs });
  }

  /** An email attempt failed: retry later, or give up (`email_failed`, details kept 7 days for the owner). */
  emailFailed(ref: string): void {
    const row = this.store.get(ref);
    if (!row || row.status !== "paid") return;
    const now = this.clock();
    const tries = row.emailTries + 1;
    if (tries > RULES.emailRetryMs.length) {
      this.store.put({ ...row, status: "email_failed", emailTries: tries, nextTryAt: null, deleteAt: now + RULES.confirmedKeepMs });
    } else {
      this.store.put({ ...row, emailTries: tries, nextTryAt: now + RULES.emailRetryMs[tries - 1] });
    }
  }

  /** Rows that need action now. */
  due(): { emails: OrderRow[]; deletions: OrderRow[]; expirations: OrderRow[] } {
    const now = this.clock();
    const rows = this.store.all();
    return {
      emails: rows.filter((r) => r.status === "paid" && r.nextTryAt !== null && r.nextTryAt <= now),
      deletions: rows.filter((r) => r.deleteAt !== null && r.deleteAt <= now),
      expirations: rows.filter((r) => r.status === "pending" && r.expiresAt <= now),
    };
  }

  /** When the single alarm should next fire (ms), or null when nothing is waiting. */
  nextWake(): number | null {
    let t: number | null = null;
    for (const r of this.store.all()) {
      for (const c of [r.status === "paid" ? r.nextTryAt : null, r.deleteAt]) {
        if (c !== null && (t === null || c < t)) t = c;
      }
    }
    return t;
  }

  /**
   * One pass of the alarm: mark timed-out pending rows `expired`, send the due emails (`send` returns true when the
   * script accepted them), delete rows past their retention. Returns the next wake time.
   */
  async tick(send: (row: OrderRow) => Promise<boolean>): Promise<number | null> {
    const d = this.due();
    for (const r of d.expirations) this.store.put({ ...r, status: "expired" });
    for (const r of d.emails) {
      let ok = false;
      try {
        ok = await send(r);
      } catch {
        ok = false;
      }
      if (ok) this.emailDone(r.ref);
      else this.emailFailed(r.ref);
    }
    const now = this.clock();
    for (const r of this.store.all()) {
      // Re-read: a paid row never has deleteAt set, and one just emailed has a fresh 7-day one.
      if (r.deleteAt !== null && r.deleteAt <= now) this.store.remove(r.ref);
    }
    return this.nextWake();
  }
}
