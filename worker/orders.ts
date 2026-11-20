// The `Orders` Durable Object (ADR-0041): pending and paid online orders, one instance (idFromName("orders")).
// SQLite-backed, so it works on the Workers Free plan. A Durable Object handles one request at a time and OrdersService
// (worker/orders-core.ts) does each read and write in one synchronous block, so a replayed or doubled webhook can only ever
// move an order from pending to paid once. KV could not promise that (eventually consistent, no atomic read-then-write).
//
// Stored here: the parsed order (name, phone, email, items, pickup, note) from the moment the customer presses Pay until the
// emails are accepted by Apps Script (then the personal data is set to NULL), or at most 48 hours if never paid, or 7 days
// if the emails could not be sent / the payment did not match. Never stored: card details (they only exist at Yoco).
// Never logged: anything but the order reference and the outcome.
//
// Automatic refunds add columns (cancel_by, cancel_json, refund_*, cmail_*), see worker/orders-core.ts. cancel_json holds the details the two
// cancellation emails need (name, phone, email, pickup, items, total; never the free-text note). It is kept until the cancellation emails are
// accepted, or until a day after the order's cut-off, whichever applies, then dropped with the row.
import { DurableObject } from "cloudflare:workers";
import { OrdersService, type CancelMailState, type OrderRow, type OrderStatus, type OrderStore, type RefundState } from "./orders-core";
import { trySend, type MailerEnv } from "./mailer";
import { cancelByLabel, cancelLink, type CancelEnv } from "./cancel-token";
import type { YocoEnv } from "./yoco";

const COLUMNS =
  "ref, attempt_id, content_hash, checkout_id, redirect_url, amount_cents, status, order_json, payment_id, last_webhook_id, created_at, expires_at, paid_at, email_tries, next_try_at, delete_at, cancel_by, cancel_json, refund_state, refund_id, refund_at, cmail_state, cmail_tries, cmail_next";

/** Columns added for automatic refunds. A Durable Object that already exists (the live one has a test order in it) gets them with ALTER TABLE; new ones have them from CREATE TABLE. */
const REFUND_COLUMNS: [string, string][] = [
  ["cancel_by", "INTEGER"],
  ["cancel_json", "TEXT"],
  ["refund_state", "TEXT"],
  ["refund_id", "TEXT"],
  ["refund_at", "INTEGER"],
  ["cmail_state", "TEXT"],
  ["cmail_tries", "INTEGER NOT NULL DEFAULT 0"],
  ["cmail_next", "INTEGER"],
];

function fromSql(r: Record<string, SqlStorageValue>): OrderRow {
  const n = (v: SqlStorageValue) => (v === null ? null : Number(v));
  const s = (v: SqlStorageValue) => (v === null ? null : String(v));
  return {
    ref: String(r.ref), attemptId: String(r.attempt_id), contentHash: String(r.content_hash), checkoutId: s(r.checkout_id),
    redirectUrl: s(r.redirect_url), amountCents: Number(r.amount_cents), status: String(r.status) as OrderStatus,
    orderJson: s(r.order_json), paymentId: s(r.payment_id), lastWebhookId: s(r.last_webhook_id), createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at), paidAt: n(r.paid_at), emailTries: Number(r.email_tries), nextTryAt: n(r.next_try_at), deleteAt: n(r.delete_at),
    cancelBy: n(r.cancel_by), cancelJson: s(r.cancel_json), refundState: s(r.refund_state) as RefundState | null, refundId: s(r.refund_id),
    refundAt: n(r.refund_at), cmailState: s(r.cmail_state) as CancelMailState | null, cmailTries: Number(r.cmail_tries ?? 0), cmailNext: n(r.cmail_next),
  };
}

export class Orders extends DurableObject {
  private svc: OrdersService;
  private mailer: MailerEnv;
  private cfg: CancelEnv & YocoEnv;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.mailer = env as unknown as MailerEnv;
    this.cfg = env as unknown as CancelEnv & YocoEnv;
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS orders (
      ref TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      checkout_id TEXT UNIQUE,
      redirect_url TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      order_json TEXT,
      payment_id TEXT,
      last_webhook_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      paid_at INTEGER,
      email_tries INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER,
      delete_at INTEGER,
      cancel_by INTEGER,
      cancel_json TEXT,
      refund_state TEXT,
      refund_id TEXT,
      refund_at INTEGER,
      cmail_state TEXT,
      cmail_tries INTEGER NOT NULL DEFAULT 0,
      cmail_next INTEGER
    )`);
    const have = new Set(sql.exec("PRAGMA table_info(orders)").toArray().map((c) => String(c.name)));
    for (const [name, type] of REFUND_COLUMNS) if (!have.has(name)) sql.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
    const one = (q: string, v: string): OrderRow | undefined => {
      const rows = sql.exec(q, v).toArray();
      return rows.length ? fromSql(rows[0]) : undefined;
    };
    const store: OrderStore = {
      get: (ref) => one(`SELECT ${COLUMNS} FROM orders WHERE ref = ?`, ref),
      byAttempt: (id) => one(`SELECT ${COLUMNS} FROM orders WHERE attempt_id = ?`, id),
      byCheckout: (id) => one(`SELECT ${COLUMNS} FROM orders WHERE checkout_id = ?`, id),
      put: (r) => {
        sql.exec(
          `INSERT INTO orders (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(ref) DO UPDATE SET checkout_id = excluded.checkout_id, redirect_url = excluded.redirect_url, status = excluded.status,
             order_json = excluded.order_json, payment_id = excluded.payment_id, last_webhook_id = excluded.last_webhook_id,
             expires_at = excluded.expires_at, paid_at = excluded.paid_at, email_tries = excluded.email_tries,
             next_try_at = excluded.next_try_at, delete_at = excluded.delete_at, cancel_by = excluded.cancel_by, cancel_json = excluded.cancel_json,
             refund_state = excluded.refund_state, refund_id = excluded.refund_id, refund_at = excluded.refund_at, cmail_state = excluded.cmail_state,
             cmail_tries = excluded.cmail_tries, cmail_next = excluded.cmail_next`,
          r.ref, r.attemptId, r.contentHash, r.checkoutId, r.redirectUrl, r.amountCents, r.status, r.orderJson, r.paymentId,
          r.lastWebhookId, r.createdAt, r.expiresAt, r.paidAt, r.emailTries, r.nextTryAt, r.deleteAt,
          r.cancelBy, r.cancelJson, r.refundState, r.refundId, r.refundAt, r.cmailState, r.cmailTries, r.cmailNext,
        );
      },
      remove: (ref) => void sql.exec("DELETE FROM orders WHERE ref = ?", ref),
      all: () => sql.exec(`SELECT ${COLUMNS} FROM orders`).toArray().map(fromSql),
    };
    this.svc = new OrdersService(store, Date.now);
  }

  /** Always leave exactly one alarm: at the next email attempt or deletion, or none. */
  private async rearm(): Promise<void> {
    const t = this.svc.nextWake();
    if (t === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(t, Date.now()));
  }

  async lookup(attemptId: string, hash: string) {
    return this.svc.lookup(attemptId, hash);
  }
  async begin(a: Parameters<OrdersService["begin"]>[0]) {
    const r = this.svc.begin(a);
    await this.rearm();
    return r;
  }
  async attach(a: Parameters<OrdersService["attach"]>[0]) {
    const r = this.svc.attach(a);
    await this.rearm();
    return r;
  }
  async drop(ref: string) {
    this.svc.drop(ref);
    await this.rearm();
  }
  async markPaid(a: Parameters<OrdersService["markPaid"]>[0]) {
    const r = this.svc.markPaid(a);
    await this.rearm(); // a paid order has next_try_at = now: the alarm sends the emails
    return r;
  }
  async status(ref: string) {
    return this.svc.status(ref);
  }
  async attention() {
    return this.svc.attention();
  }
  async cancelInfo(ref: string, notAfter?: number) {
    return this.svc.cancelInfo(ref, notAfter);
  }
  async beginCancel(ref: string, notAfter?: number) {
    const r = this.svc.beginCancel(ref, notAfter);
    await this.rearm();
    return r;
  }
  async finishCancel(ref: string, outcome: Parameters<OrdersService["finishCancel"]>[1]) {
    const r = this.svc.finishCancel(ref, outcome);
    await this.rearm(); // the two cancellation emails are due now: the alarm sends them
    return r;
  }

  async alarm(): Promise<void> {
    try {
      await this.svc.tick(
        async (row) => {
          if (!row.orderJson || !row.checkoutId) return false;
          let order: Record<string, unknown>;
          try {
            order = JSON.parse(row.orderJson) as Record<string, unknown>;
          } catch {
            return false;
          }
          // The signed cancel link is made HERE (the script only prints it) and only while cancelling still works.
          const open = row.cancelBy !== null && Date.now() < row.cancelBy;
          const link = open ? await cancelLink(this.cfg, row.ref, row.cancelBy) : null;
          return trySend(this.mailer, {
            ...order, paid: true, checkoutId: row.checkoutId,
            ...(link && row.cancelBy !== null ? { cancelUrl: link, cancelByLabel: cancelByLabel(row.cancelBy) } : {}),
          });
        },
        async (row) => {
          const payload = this.svc.cancelMailPayload(row);
          return payload ? trySend(this.mailer, payload) : false;
        },
      );
    } catch (err) {
      console.error("orders alarm failed:", err instanceof Error ? err.name : "unknown"); // name only, never the message
    }
    await this.rearm();
  }
}
