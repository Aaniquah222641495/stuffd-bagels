// Bundles a Worker .ts file for plain Node (with the esbuild that comes with wrangler) so tests can run the real code.
import { execFileSync } from "node:child_process";
import { readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpm = path.join(root, "node_modules/.pnpm");
const esb = readdirSync(pnpm).filter((d) => d.startsWith("esbuild@")).sort().at(-1);
const dir = mkdtempSync(path.join(tmpdir(), "stuffd-bundle-"));

export async function bundle(file) {
  const out = path.join(dir, path.basename(file).replace(/\.ts$/, ".mjs"));
  execFileSync(path.join(pnpm, esb, "node_modules/esbuild/bin/esbuild"), [path.join(root, file), "--bundle", "--format=esm", "--platform=neutral", `--outfile=${out}`], { stdio: "ignore" });
  return import(pathToFileURL(out).href);
}

/**
 * A stand-in for the LIMITER Durable Object namespace, built on the REAL counter logic (limiter-core.ts).
 * Each key gets its own store, and take() is synchronous like the Durable Object, so it behaves the same under parallel calls.
 * `clock` lets a test move time; `fail` makes every call throw (the "store is down" case).
 */
export async function fakeLimiter(clock = { now: () => Date.now() }, state = { fail: false }) {
  const core = await bundle("worker/limiter-core.ts");
  const stores = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) {
      const m = new Map();
      stores.set(name, { get: (id) => m.get(id), put: (id, row) => void m.set(id, row) });
    }
    return stores.get(name);
  };
  return {
    state,
    keys: () => [...stores.keys()],
    ns: {
      idFromName: (n) => n,
      get: (name) => ({
        async take(rules) { if (state.fail) throw new Error("down"); await Promise.resolve(); return core.takeRules(storeFor(name), rules, clock.now()); },
        async refund(ids) { if (state.fail) throw new Error("down"); core.refundRules(storeFor(name), ids, clock.now()); },
      }),
    },
  };
}

/**
 * A stand-in for the ORDERS Durable Object namespace, built on the REAL state machine (orders-core.ts): one in-memory store,
 * the same OrdersService the Durable Object wraps, and a clock the test can move. `svc` is exposed so a test can run the alarm
 * (`svc.tick(send)`) and inspect rows (`rows()`). `fail` makes every call throw (the "store is down" case).
 */
export async function fakeOrders(clock = { now: () => Date.now() }, state = { fail: false }) {
  const core = await bundle("worker/orders-core.ts");
  const m = new Map();
  const store = {
    get: (ref) => m.get(ref),
    byAttempt: (id) => [...m.values()].find((r) => r.attemptId === id),
    byCheckout: (id) => [...m.values()].find((r) => r.checkoutId === id),
    put: (r) => void m.set(r.ref, { ...r }),
    remove: (ref) => void m.delete(ref),
    all: () => [...m.values()].map((r) => ({ ...r })),
  };
  const svc = new core.OrdersService(store, () => clock.now());
  const stub = new Proxy({}, {
    get: (_t, name) => async (...args) => {
      if (state.fail) throw new Error("down");
      await Promise.resolve();
      return svc[name](...args);
    },
  });
  return { core, svc, state, rows: () => store.all(), ns: { idFromName: (n) => n, get: () => stub } };
}

/** Cloudflare's documented Turnstile test token: the only token the documented always-pass test secret accepts. */
export const TS_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
export const TS_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Answers a siteverify call the way Cloudflare answers for its documented always-pass test secret; null for any other URL. */
export function fakeSiteverify(url, init) {
  if (String(url) !== TS_SITEVERIFY) return null;
  const f = new URLSearchParams(String(init.body));
  const good = f.get("secret") === "1x0000000000000000000000000000000AA" && f.get("response") === TS_DUMMY_TOKEN;
  return new Response(JSON.stringify(good ? { success: true, hostname: "example.com", challenge_ts: new Date().toISOString() } : { success: false, "error-codes": ["invalid-input-response"] }));
}

/** A made-up CANCEL_LINK_SECRET for tests (32+ characters, like the real one). Never a real secret. */
export const TEST_CANCEL_SECRET = "test-cancel-link-secret-0123456789-abcdefghij";

/** Yoco settings for Node tests of the order path: a test key that is obviously fake, and a test-mode origin. APP_ENV development lets the Turnstile test keys work (never in production). */
export const YOCO_TEST_ENV = { APP_ENV: "development", CANCEL_LINK_SECRET: TEST_CANCEL_SECRET, YOCO_SECRET_KEY: "sk_test_localfake1234567890", YOCO_WEBHOOK_SECRET: "whsec_" + Buffer.alloc(24, 7).toString("base64"), YOCO_MODE: "test", SITE_ORIGIN: "https://preview.example.workers.dev" };

/** A fetch that answers Yoco's create-checkout call like Yoco would, and hands every other request to `other`. `calls` records the Yoco ones. */
export function fakeYocoFetch(other = async () => new Response('{"ok":true}')) {
  const calls = [];
  const f = async (url, init) => {
    const ts = fakeSiteverify(url, init);
    if (ts) return ts;
    if (String(url).startsWith("https://payments.yoco.com/api/checkouts")) {
      calls.push({ headers: init.headers, body: JSON.parse(init.body) });
      const id = `ch_${calls.length}${Math.random().toString(16).slice(2, 8)}`;
      return new Response(JSON.stringify({ id, status: "created", redirectUrl: `https://c.yoco.com/checkout/${id}`, processingMode: "test" }), { status: 201 });
    }
    return other(url, init);
  };
  f.calls = calls;
  return f;
}
