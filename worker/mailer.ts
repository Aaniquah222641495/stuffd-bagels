// Talking to the client's Google Apps Script (apps-script/Code.gs), which sends the emails from her Gmail address.
// Shared by the booking form (forms.ts) and the Orders Durable Object (orders.ts), which sends the paid-order emails.
import { HttpError } from "./http";

export interface MailerEnv {
  APPS_SCRIPT_URL?: string;
  APPS_SCRIPT_TOKEN?: string;
}

/** APPS_SCRIPT_TOKEN must be at least this long (Code.gs refuses anything shorter). */
export const MIN_TOKEN = 32;

/** True when both secrets are set. Without the token the script would be an open mail relay, so never send without it. */
export function mailerReady(env: MailerEnv): boolean {
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = env;
  return !!url && !!token && token.length >= MIN_TOKEN;
}

/** Both secrets must be set (503 "not switched on yet" otherwise). */
export function assertSwitchedOn(env: MailerEnv): { url: string; token: string } {
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = env;
  if (!url || !token || token.length < MIN_TOKEN) {
    throw new HttpError(503, "Online ordering isn't switched on yet. Please email stuffd.bagels@gmail.com.");
  }
  return { url, token };
}

/** One POST to the script. True only when it answers { ok: true }. Never throws, never logs the payload. */
export async function trySend(env: MailerEnv, payload: object): Promise<boolean> {
  if (!mailerReady(env)) return false; // again, so no code path can send without it
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = env;
  let res: Response;
  try {
    res = await fetch(url as string, {
      method: "POST",
      // text/plain: Apps Script web apps do not answer CORS preflights, and this is server to server anyway.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, token, receivedAt: new Date().toISOString() }),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return false;
  }
  let reply: unknown = null;
  try {
    reply = JSON.parse(await res.text());
  } catch {
    // not JSON: treated as a failure below
  }
  return res.ok && typeof reply === "object" && reply !== null && (reply as { ok?: unknown }).ok === true;
}

/** Like trySend, but a failure is a 502 with a plain message (the booking form answers the visitor with it). */
export async function forward(env: MailerEnv, payload: object): Promise<void> {
  assertSwitchedOn(env);
  if (!(await trySend(env, payload))) {
    throw new HttpError(502, "We couldn't send that just now. Please try again, or email stuffd.bagels@gmail.com.");
  }
}
