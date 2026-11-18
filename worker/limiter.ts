// Durable Object that holds the counters for ONE key (one admin client, one form sender, one
// recipient, or the day's total). SQLite-backed, so it works on the Workers Free plan.
// A Durable Object handles one request at a time and this code does its read and write in one
// synchronous block, so parallel requests cannot slip past a limit (unlike a KV read-then-write).
// Stored: a counter and a reset time, under a keyed hash. No IP address, no email, no order content.
// The row removes itself (alarm) once its window has ended.
import { DurableObject } from "cloudflare:workers";
import { refundRules, takeRules, type Row, type RowStore, type Rule, type Verdict } from "./limiter-core";

export class Limiter extends DurableObject {
  private store: RowStore;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS buckets (id TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)");
    this.store = {
      get: (id) => {
        const rows = sql.exec("SELECT count, reset_at FROM buckets WHERE id = ?", id).toArray();
        return rows.length ? ({ count: Number(rows[0].count), resetAt: Number(rows[0].reset_at) } satisfies Row) : undefined;
      },
      put: (id, row) => {
        sql.exec("INSERT INTO buckets (id, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at", id, row.count, row.resetAt);
      },
    };
  }

  async take(rules: Rule[]): Promise<Verdict> {
    const now = Date.now();
    const verdict = takeRules(this.store, rules, now); // synchronous: nothing can interleave
    if (verdict.ok) await this.scheduleCleanup();
    return verdict;
  }

  async refund(ids: string[]): Promise<void> {
    refundRules(this.store, ids, Date.now());
  }

  private async scheduleCleanup(): Promise<void> {
    const rows = this.ctx.storage.sql.exec("SELECT MAX(reset_at) AS t FROM buckets").toArray();
    const t = Number(rows[0]?.t);
    if (Number.isFinite(t) && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(t + 1000);
  }

  async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM buckets WHERE reset_at <= ?", Date.now());
    const left = sql.exec("SELECT MAX(reset_at) AS t FROM buckets").toArray();
    const t = Number(left[0]?.t);
    if (Number.isFinite(t) && t > 0) await this.ctx.storage.setAlarm(t + 1000);
    else await this.ctx.storage.deleteAll();
  }
}
