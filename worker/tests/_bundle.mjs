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
