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
//
// Automatic refunds (founder 2026-11-19) are a second, separate state `refundState` on a paid order, so `status` keeps meaning "was it paid":
//           null -> refunding (claimed, one request at a time) -> refunded | pending (Yoco accepted it) | failed (Yoco said no or went quiet)
//           failed -> refunding again (the customer may press again before the cut-off; Yoco's Idempotency-Key makes a repeat safe)
//           refunding for more than 2 minutes counts as stuck and may be claimed again (same Idempotency-Key)
// Yoco's refund call happens in the Worker between `beginCancel` and `finishCancel` (a Durable Object lets other requests in while it
// waits on the network, so the claim is written FIRST and a second click sees `refunding`). The two cancellation emails (owner and
// customer) go out through their own outbox, cmail*, with the same retry schedule as the order emails.

export type OrderStatus = "creating" | "pending" | "expired" | "paid" | "confirmed" | "email_failed" | "mismatch";

export type RefundState = "refunding" | "refunded" | "pending" | "failed";
export type CancelMailState = "due" | "sent" | "failed";

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
  /** First instant self-cancel is refused (epoch ms): the order's Wednesday cut-off. NULL = no self-cancel (an order made before refunds existed). */
  cancelBy: number | null;
  /** What the cancellation emails need (name, phone, email, pickup, items, total). Never the free-text note. NULL once not needed. */
  cancelJson: string | null;
  refundState: RefundState | null;
  refundId: string | null;
  /** When the refund was claimed, then when Yoco answered (epoch ms). */
  refundAt: number | null;
  cmailState: CancelMailState | null;
  cmailTries: number;
  cmailNext: number | null;
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
  /** A paid order's row (and the cancel details in it) is kept at least until this long after its cut-off: that is how long a cancel link can work. */
  afterCutoffMs: 1 * DAY,
  /** A claimed refund that never got an answer recorded is treated as stuck after this and may be claimed again. */
  refundClaimStaleMs: 2 * MIN,
  /** A refunded order keeps a stub (no personal data) this long, so the link keeps saying "already refunded" and not "cut-off passed". */
  refundedKeepMs: 60 * DAY,
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

/** What the cancel page may be told about an order (never personal data beyond what the link-holder already has: amount and collection day). */
export type CancelInfo =
  | { kind: "open"; ref: string; amountCents: number; pickupDate: string | null; cancelBy: number; retry: boolean }
  | { kind: "closed"; ref: string; cancelBy: number | null }
  | { kind: "refunded" | "pending"; ref: string; amountCents: number }
  | { kind: "busy"; ref: string }
  | { kind: "failed"; ref: string }
  | { kind: "unknown" };

export type BeginCancelResult =
  | { kind: "claimed"; ref: string; checkoutId: string; amountCents: number }
  | { kind: "already"; ref: string; state: "refunded" | "pending" }
  | { kind: "closed"; ref: string; cancelBy: number | null }
  | { kind: "busy"; ref: string }
  | { kind: "failed_closed"; ref: string }
  | { kind: "unknown" };

export type RefundOutcome = { kind: "refunded" | "pending"; refundId: string } | { kind: "failed" };

export interface AttentionItem {
  ref: string;
  /** refund_failed: the customer cancelled in time but Yoco did not confirm the refund (owner: check Yoco, refund by hand). cancel_email_failed: the cancellation emails never went out. */
  status: "email_failed" | "mismatch" | "refund_failed" | "cancel_email_failed";
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
    // A hash of the order fields is dropped with the personal data (""): such a row can only say "already paid" to a repeat press.
    if (row.contentHash !== "" && row.contentHash !== hash) return { kind: "changed" };
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
  begin(a: { attemptId: string; contentHash: string; ref: string; amountCents: number; orderJson: string; cancelBy?: number | null; cancelJson?: string | null }): BeginResult {
    const row = this.store.byAttempt(a.attemptId);
    if (row) return this.existing(row, a.contentHash);
    if (this.store.get(a.ref)) throw new Error("ref collision");
    const now = this.clock();
    this.store.put({
      ref: a.ref, attemptId: a.attemptId, contentHash: a.contentHash, checkoutId: null, redirectUrl: null,
      amountCents: a.amountCents, status: "creating", orderJson: a.orderJson, paymentId: null, lastWebhookId: null,
      createdAt: now, expiresAt: now + RULES.unpaidMs, paidAt: null, emailTries: 0, nextTryAt: null,
      deleteAt: now + RULES.creatingMs,
      cancelBy: a.cancelBy ?? null, cancelJson: a.cancelJson ?? null, refundState: null, refundId: null, refundAt: null,
      cmailState: null, cmailTries: 0, cmailNext: null,
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
      .filter((r) => r.status === "email_failed" || r.status === "mismatch" || r.refundState === "failed" || r.cmailState === "failed")
      .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))
      .map((r) => {
        let order: unknown = null;
        try {
          const raw = r.orderJson ?? r.cancelJson;
          order = raw ? JSON.parse(raw) : null;
        } catch {
          // leave null
        }
        const status: AttentionItem["status"] =
          r.refundState === "failed" ? "refund_failed" : r.cmailState === "failed" ? "cancel_email_failed" : (r.status as "email_failed" | "mismatch");
        return { ref: r.ref, status, amountCents: r.amountCents, checkoutId: r.checkoutId, paymentId: r.paymentId, paidAt: r.paidAt, order };
      });
  }

  /** Emails accepted by the script: drop the personal data, keep a stub for 7 days. */
  emailDone(ref: string): void {
    const row = this.store.get(ref);
    if (!row || row.status !== "paid") return;
    // Kept until a week from now, or a day past the cut-off if that is later: the cancel link works until then and needs the row.
    const keep = Math.max(this.clock() + RULES.confirmedKeepMs, (row.cancelBy ?? 0) + RULES.afterCutoffMs);
    this.store.put({ ...row, status: "confirmed", orderJson: null, nextTryAt: null, deleteAt: keep });
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

  // ---------------------------------------------------------------------------------------------------------------------
  // Automatic refunds. The order is cancelled by the customer's signed link (worker/cancel-token.ts); nothing here trusts the
  // browser: the amount is the stored one, the cut-off is the stored one, the clock is ours.
  // ---------------------------------------------------------------------------------------------------------------------

  private paidLike(row: OrderRow): boolean {
    return row.status === "paid" || row.status === "confirmed" || row.status === "email_failed";
  }

  private pickupDateOf(row: OrderRow): string | null {
    try {
      const d = row.cancelJson ? (JSON.parse(row.cancelJson) as { pickupDate?: unknown }).pickupDate : null;
      return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    } catch {
      return null;
    }
  }

  /** Read only: what the cancel page should show for this order right now. */
  cancelInfo(ref: string, notAfter?: number): CancelInfo {
    const row = this.store.get(ref);
    if (!row || !this.paidLike(row) || row.cancelBy === null) return { kind: "unknown" };
    if (row.refundState === "refunded" || row.refundState === "pending") return { kind: row.refundState, ref, amountCents: row.amountCents };
    const now = this.clock();
    if (row.refundState === "refunding" && now - (row.refundAt ?? 0) < RULES.refundClaimStaleMs) return { kind: "busy", ref };
    const until = Math.min(row.cancelBy, notAfter ?? Infinity); // the link's own expiry can only make it shorter
    if (now >= until) return row.refundState === "failed" ? { kind: "failed", ref } : { kind: "closed", ref, cancelBy: row.cancelBy };
    return { kind: "open", ref, amountCents: row.amountCents, pickupDate: this.pickupDateOf(row), cancelBy: row.cancelBy, retry: row.refundState === "failed" };
  }

  /**
   * The customer pressed "Yes, cancel and refund". Decides, in one synchronous block, whether THIS request may call Yoco:
   * only a paid order, only before its stored cut-off, only if no refund is already done, accepted or in flight.
   * A second click while the first is running gets `busy`; after Yoco accepted a refund it gets `already`. Nothing here calls Yoco.
   */
  beginCancel(ref: string, notAfter?: number): BeginCancelResult {
    const row = this.store.get(ref);
    if (!row || !this.paidLike(row) || row.cancelBy === null || !row.checkoutId) return { kind: "unknown" };
    if (row.refundState === "refunded" || row.refundState === "pending") return { kind: "already", ref, state: row.refundState };
    const now = this.clock();
    if (row.refundState === "refunding" && now - (row.refundAt ?? 0) < RULES.refundClaimStaleMs) return { kind: "busy", ref };
    const until = Math.min(row.cancelBy, notAfter ?? Infinity); // the link's own expiry can only make it shorter
    if (now >= until) return row.refundState === "failed" ? { kind: "failed_closed", ref } : { kind: "closed", ref, cancelBy: row.cancelBy };
    // Claim it. An order whose confirmation email is still being retried must not send "order confirmed" after this, and its reminder is deleted by the script.
    this.store.put({
      ...row, status: row.status === "paid" ? "confirmed" : row.status, nextTryAt: null, orderJson: row.status === "paid" ? null : row.orderJson,
      refundState: "refunding", refundAt: now,
    });
    return { kind: "claimed", ref, checkoutId: row.checkoutId, amountCents: row.amountCents };
  }

  /**
   * Yoco answered (or did not). `refunded` and `pending` are both a refund Yoco has accepted; `failed` is anything else, including no answer
   * (the outcome is then unknown, so the owner is told to check Yoco and the customer may press again: Yoco's Idempotency-Key makes that safe).
   * Queues the two cancellation emails. Only a row we claimed can be finished, and a finished refund is never overwritten by a failure.
   */
  finishCancel(ref: string, outcome: RefundOutcome): "refunded" | "pending" | "failed" | "ignored" {
    const row = this.store.get(ref);
    if (!row) return "ignored";
    if (row.refundState === "refunded" || row.refundState === "pending") return row.refundState;
    if (row.refundState !== "refunding") return "ignored";
    const now = this.clock();
    this.store.put({
      ...row, refundState: outcome.kind === "failed" ? "failed" : outcome.kind, refundId: outcome.kind === "failed" ? null : outcome.refundId,
      refundAt: now, cmailState: "due", cmailTries: 0, cmailNext: now,
      deleteAt: Math.max(row.deleteAt ?? 0, now + RULES.confirmedKeepMs, (row.cancelBy ?? 0) + RULES.afterCutoffMs),
    });
    return outcome.kind;
  }

  /** The body for the cancellation emails (owner and customer), or null when the details are gone. */
  cancelMailPayload(row: OrderRow): Record<string, unknown> | null {
    if (!row.cancelJson || !row.checkoutId || (row.refundState !== "refunded" && row.refundState !== "pending" && row.refundState !== "failed")) return null;
    try {
      return { ...(JSON.parse(row.cancelJson) as Record<string, unknown>), type: "cancel", ref: row.ref, outcome: row.refundState === "failed" ? "failed" : row.refundState, checkoutId: row.checkoutId };
    } catch {
      return null;
    }
  }

  /** The script accepted the cancellation emails: a refund Yoco accepted drops its personal data; a failed one keeps it for the owner and a retry. */
  cancelMailDone(ref: string): void {
    const row = this.store.get(ref);
    if (!row || row.cmailState !== "due") return;
    const accepted = row.refundState === "refunded" || row.refundState === "pending";
    this.store.put({
      ...row, cmailState: "sent", cmailNext: null, cmailTries: 0,
      cancelJson: accepted ? null : row.cancelJson,
      orderJson: accepted ? null : row.orderJson,
      contentHash: accepted ? "" : row.contentHash, // a hash of name, phone and email is personal data too: gone with them (dp-counsel 2026-11-20)
      deleteAt: accepted ? this.clock() + RULES.refundedKeepMs : row.deleteAt,
    });
  }

  /** A cancellation email attempt failed: retry later, or give up (the owner sees it under "needs you", details kept 7 days). */
  cancelMailFailed(ref: string): void {
    const row = this.store.get(ref);
    if (!row || row.cmailState !== "due") return;
    const now = this.clock();
    const tries = row.cmailTries + 1;
    if (tries > RULES.emailRetryMs.length) {
      this.store.put({ ...row, cmailState: "failed", cmailTries: tries, cmailNext: null, deleteAt: Math.max(row.deleteAt ?? 0, now + RULES.confirmedKeepMs) });
    } else {
      this.store.put({ ...row, cmailTries: tries, cmailNext: now + RULES.emailRetryMs[tries - 1] });
    }
  }

  /** Rows that need action now. */
  due(): { emails: OrderRow[]; cancelMails: OrderRow[]; deletions: OrderRow[]; expirations: OrderRow[] } {
    const now = this.clock();
    const rows = this.store.all();
    return {
      emails: rows.filter((r) => r.status === "paid" && r.nextTryAt !== null && r.nextTryAt <= now),
      cancelMails: rows.filter((r) => r.cmailState === "due" && r.cmailNext !== null && r.cmailNext <= now),
      deletions: rows.filter((r) => r.deleteAt !== null && r.deleteAt <= now),
      expirations: rows.filter((r) => r.status === "pending" && r.expiresAt <= now),
    };
  }

  /** When the single alarm should next fire (ms), or null when nothing is waiting. */
  nextWake(): number | null {
    let t: number | null = null;
    for (const r of this.store.all()) {
      for (const c of [r.status === "paid" ? r.nextTryAt : null, r.cmailState === "due" ? r.cmailNext : null, r.deleteAt]) {
        if (c !== null && (t === null || c < t)) t = c;
      }
    }
    return t;
  }

  /**
   * One pass of the alarm: mark timed-out pending rows `expired`, send the due emails (`send` returns true when the
   * script accepted them), delete rows past their retention. Returns the next wake time.
   */
  async tick(send: (row: OrderRow) => Promise<boolean>, sendCancel?: (row: OrderRow) => Promise<boolean>): Promise<number | null> {
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
    for (const r of sendCancel ? d.cancelMails : []) {
      let ok = false;
      try {
        ok = await sendCancel!(r);
      } catch {
        ok = false;
      }
      if (ok) this.cancelMailDone(r.ref);
      else this.cancelMailFailed(r.ref);
    }
    const now = this.clock();
    for (const r of this.store.all()) {
      // Re-read: a paid row never has deleteAt set, and one just emailed has a fresh 7-day one.
      if (r.deleteAt !== null && r.deleteAt <= now) this.store.remove(r.ref);
    }
    return this.nextWake();
  }
}
