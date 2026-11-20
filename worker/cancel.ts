// Automatic refunds (founder decision 2026-11-19: she does not want to handle refunds).
// The customer's confirmation email carries a signed link to /order/cancel (worker/cancel-token.ts). That page is static: opening it
// changes nothing. It asks this file two questions, both POST so the token travels in the body and never in a URL or a log:
//   POST /api/order/cancel/check   what is the state of this order? (read only; rate limited)
//   POST /api/order/cancel         cancel and refund IN FULL (Turnstile, rate limited, then exactly one Yoco refund call)
// Safety rules, in the order they bite:
//   1. No CANCEL_LINK_SECRET (32+ chars), no Orders object, or no usable Yoco setup: 503, fail closed.
//   2. A token that does not verify: 400. Nothing else is looked at.
//   3. Turnstile, then per-network and per-order rate limits (a failed check uses no allowance).
//   4. The Orders object decides, in one synchronous step, whether THIS request may call Yoco (OrdersService.beginCancel): paid order,
//      before the stored cut-off, no refund already done or running. The amount is never taken from the browser: Yoco refunds the whole payment.
//   5. Yoco's answer is recorded (finishCancel). `succeeded` and `pending` count as refunded; anything else, including no answer, is recorded as
//      FAILED (the owner is emailed to check Yoco and the customer may press again: the Idempotency-Key `refund-<ref>` makes that safe).
//   6. The emails (owner: "SB-xxxx cancelled and refunded", customer: refund confirmation) and the deletion of the pickup reminder are sent
//      by the Orders object's alarm through the Apps Script, with retries. Nothing here waits on Gmail.
// Logs carry only the reference and the outcome: never the token, the secret, a name or an email address.
import { HttpError, json, readJsonObject } from "./http";
import { hashKey, ipBucket, limiterSalt, refund, take, type LimiterEnv, type Rule } from "./limiter-client";
import { orders, type OrdersEnv } from "./orders-client";
import { cancelByLabel, cancelReady, verifyCancelToken, type CancelEnv } from "./cancel-token";
import { YocoError, modeOk, refundCheckout, type YocoEnv } from "./yoco";
import { precheckTurnstile, verifyTurnstile, type TurnstileEnv } from "./turnstile";

export interface CancelHandlerEnv extends LimiterEnv, OrdersEnv, YocoEnv, TurnstileEnv, CancelEnv {
  ADMIN_PASSWORD?: string;
  LIMITER_SALT?: string;
}

export const CANCEL_LIMITS = {
  checkPerIpPerHour: 30,
  cancelPerIpPerHour: 10,
  cancelPerOrderPerHour: 6,
};

const NOT_ON = "Cancelling online isn't switched on yet. Please email stuffd.bagels@gmail.com with your order reference.";
const BAD_LINK = "That link isn't valid. Please use the link in your confirmation email, or email stuffd.bagels@gmail.com.";
const DOWN = "We can't do that right now. Please try again in a minute.";

function note(outcome: string, ref?: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evt: "cancel", outcome, ...(ref ? { ref } : {}), ...extra }));
}

/** 503 unless the signing secret and the Orders object are there (and, for a real refund, Yoco is set up for its mode). */
function assertReady(env: CancelHandlerEnv, forRefund: boolean): void {
  if (!cancelReady(env)) {
    console.error("cancel link: CANCEL_LINK_SECRET is missing or shorter than 32 characters, so cancelling is refused. Run: npx wrangler@4.148.0 secret put CANCEL_LINK_SECRET");
    throw new HttpError(503, NOT_ON);
  }
  if (!env.ORDERS || (forRefund && modeOk(env) !== null)) throw new HttpError(503, NOT_ON);
}

async function ipKey(request: Request, env: CancelHandlerEnv, kind: string): Promise<string> {
  return `${kind}:${await hashKey(ipBucket(request.headers.get("CF-Connecting-IP") ?? "unknown"), limiterSalt(env))}`;
}

/** Takes one slot on each step (all or nothing). Returns a function that gives the slots back. Fails closed (503) if the counters are down. */
async function limit(env: CancelHandlerEnv, steps: { key: string; rule: Rule }[]): Promise<() => Promise<void>> {
  const taken: typeof steps = [];
  const giveBack = async () => void (await Promise.all(taken.map((t) => refund(env, t.key, [t.rule.id]))));
  for (const step of steps) {
    let verdict;
    try {
      verdict = await take(env, step.key, [step.rule]);
    } catch {
      await giveBack();
      throw new HttpError(503, DOWN);
    }
    if (!verdict.ok) {
      await giveBack();
      throw new HttpError(429, "That's a few too many tries. Please wait a little and try again.", { "Retry-After": String(Math.min(verdict.retryAfter, 3600)) });
    }
    taken.push(step);
  }
  return giveBack;
}

async function tokenOf(env: CancelHandlerEnv, body: Record<string, unknown>) {
  const t = await verifyCancelToken(env, body.token);
  if (!t.ok) throw new HttpError(400, BAD_LINK);
  return t;
}

const rand = (cents: number) => cents / 100;

/** POST /api/order/cancel/check { token } -> { state, ... }. Read only: nothing is changed, no Yoco call, no Turnstile. */
export async function handleCancelCheck(request: Request, env: CancelHandlerEnv, now: number = Date.now()): Promise<Response> {
  const body = await readJsonObject(request);
  assertReady(env, false);
  const t = await tokenOf(env, body);
  await limit(env, [{ key: await ipKey(request, env, "cancelchk"), rule: { id: "hour", limit: CANCEL_LIMITS.checkPerIpPerHour, windowSec: 3600 } }]);
  let info;
  try {
    info = await orders(env).cancelInfo(t.ref, t.cancelByMs);
  } catch {
    throw new HttpError(503, DOWN);
  }
  switch (info.kind) {
    case "open":
      return json({ state: "open", ref: info.ref, total: rand(info.amountCents), pickupDate: info.pickupDate, cancelBy: cancelByLabel(info.cancelBy), retry: info.retry });
    case "refunded":
    case "pending":
      return json({ state: info.kind, ref: info.ref, total: rand(info.amountCents) });
    case "closed":
    case "busy":
    case "failed":
      return json({ state: info.kind, ref: info.ref });
    default:
      // No such order any more. A link whose time is up is simply "closed" (the page then explains the credit); before that it is a mystery.
      return json({ state: now >= t.cancelByMs ? "closed" : "unknown", ref: t.ref });
  }
}

/** POST /api/order/cancel { token, turnstileToken } -> { state: refunded | pending | failed | busy | closed | unknown, ... }. */
export async function handleCancel(request: Request, env: CancelHandlerEnv, now: number = Date.now()): Promise<Response> {
  const body = await readJsonObject(request);
  assertReady(env, true);
  const t = await tokenOf(env, body); // a bad link costs nothing else: no Turnstile call, no allowance
  precheckTurnstile(env, body.turnstileToken);
  await verifyTurnstile(request, env, body.turnstileToken, "cancel");
  await limit(env, [
    { key: await ipKey(request, env, "cancel"), rule: { id: "hour", limit: CANCEL_LIMITS.cancelPerIpPerHour, windowSec: 3600 } },
    { key: `cancelref:${await hashKey(t.ref, limiterSalt(env))}`, rule: { id: "hour", limit: CANCEL_LIMITS.cancelPerOrderPerHour, windowSec: 3600 } },
  ]);

  const store = orders(env);
  let begun;
  try {
    begun = await store.beginCancel(t.ref, t.cancelByMs);
  } catch {
    throw new HttpError(503, DOWN);
  }
  switch (begun.kind) {
    case "already":
      note("already-" + begun.state, begun.ref);
      return json({ state: begun.state, ref: begun.ref });
    case "busy":
      note("busy", begun.ref);
      return json({ state: "busy", ref: begun.ref });
    case "closed":
      note("closed", begun.ref);
      return json({ state: "closed", ref: begun.ref });
    case "failed_closed":
      note("failed-closed", begun.ref);
      return json({ state: "failed", ref: begun.ref });
    case "unknown":
      note("unknown", t.ref);
      return json({ state: now >= t.cancelByMs ? "closed" : "unknown", ref: t.ref });
  }

  // claimed: this is the one request that may call Yoco for this order right now.
  let accepted: { refundId: string; status: "succeeded" | "pending" } | null = null;
  try {
    accepted = await refundCheckout(env, { checkoutId: begun.checkoutId, ref: begun.ref });
  } catch (err) {
    console.error("refund failed:", err instanceof YocoError ? `${err.reason} ${err.status}` : "unknown"); // reason only: no body, no key, no id
  }
  let state: "refunded" | "pending" | "failed" | "ignored";
  try {
    state = await store.finishCancel(begun.ref, accepted ? { kind: accepted.status === "succeeded" ? "refunded" : "pending", refundId: accepted.refundId } : { kind: "failed" });
  } catch {
    // The row stays "refunding" and counts as stuck after 2 minutes: the next press repeats the call with the same Idempotency-Key, so it can't refund twice.
    console.error(accepted ? `refund ACCEPTED by Yoco but not saved: ${begun.ref}. Check the Yoco app and the order before refunding again.` : `refund not saved: ${begun.ref}`);
    throw new HttpError(503, DOWN);
  }
  if (state === "ignored") state = accepted ? (accepted.status === "succeeded" ? "refunded" : "pending") : "failed";
  note(state, begun.ref, accepted ? { yoco: accepted.status } : {});
  return json({ state, ref: begun.ref, total: rand(begun.amountCents) });
}
