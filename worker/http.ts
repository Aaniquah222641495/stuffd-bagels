// Small HTTP helpers for the API. Every response from /api goes through json() so the
// security headers are always set (the static _headers file does not apply to Worker
// responses). Errors are always short, generic JSON: never a stack trace or a file path.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type CacheMode = "public" | "none";

export function json(
  body: unknown,
  status = 200,
  cache: CacheMode = "none",
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Cache-Control": cache === "public" && status === 200 ? "public, max-age=30" : "no-store",
      ...extra,
    },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status, "none", err.headers);
  // Anything unexpected: log only the error name (never the message or stack) and answer generically.
  console.error("api error:", err instanceof Error ? err.name : "unknown");
  return json({ error: "Server error" }, 500);
}

export const MAX_BODY_BYTES = 10 * 1024;

/** Reads a JSON object body, refusing anything over 10 KB without buffering all of it. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const bad = () => new HttpError(400, "Invalid request");
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw bad();
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw bad();
  if (!request.body) throw bad();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw bad();
    }
    chunks.push(value);
  }
  if (total === 0) throw bad();
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw bad();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw bad();
  return parsed as Record<string, unknown>;
}

/** True when an /api request arrived over plain HTTP from the internet. Loopback (wrangler dev on this computer) is allowed. */
export function plainHttpRefused(url: URL): boolean {
  return url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** A copy of an asset response with X-Robots-Tag: noindex, nofollow (preview only). */
export function withNoindex(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

/**
 * Reads the body as text, exactly as received (a webhook signature covers the raw bytes, so it must not be re-serialised).
 * Refuses anything over `max` bytes without buffering all of it. No content-type requirement.
 */
export async function readRawText(request: Request, max: number): Promise<string> {
  const tooBig = () => new HttpError(413, "Request too large");
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > max) throw tooBig();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new HttpError(400, "Invalid request");
  }
}

/** The kitchen prep sheet's address (plain var PREP_SHEET_URL, not a secret). Only an https Google Sheets link is passed on; anything else is "". */
export function prepSheetLink(value: string | undefined): string {
  const v = (value ?? "").trim();
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:[/?#][^\s"<>]*)?$/.test(v) ? v : "";
}
