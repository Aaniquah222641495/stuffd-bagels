// Collection hours -> one-hour time chips, and the optional structured hours on a pickup point.
// Run: node worker/tests/pickup-slots.mjs     (Node only; bundles worker/store.ts with wrangler's esbuild)
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundle } from "./_bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);
const store = await bundle("worker/store.ts");

const FIVE = ["1pm to 2pm", "2pm to 3pm", "3pm to 4pm", "4pm to 5pm", "5pm to 6pm"];
// structured hours win
assert.deepEqual(col.timeSlots({ opens: "13:00", closes: "18:00", days: "ignored 9am to 10am" }), FIVE);
assert.equal(col.hoursLabel(col.pickupHours({ opens: "13:00", closes: "18:00" })), "1pm to 6pm");
// a part hour at the end is left out; minutes are shown
assert.deepEqual(col.timeSlots({ opens: "13:30", closes: "16:00" }), ["1:30pm to 2:30pm", "2:30pm to 3:30pm"]);
assert.deepEqual(col.timeSlots({ opens: "00:00", closes: "02:00" }), ["12am to 1am", "1am to 2am"]);
assert.deepEqual(col.timeSlots({ opens: "11:00", closes: "13:00" }), ["11am to 12pm", "12pm to 1pm"]);
// bad structured hours fall back to the text, then to nothing
assert.deepEqual(col.timeSlots({ opens: "18:00", closes: "13:00", days: "Saturdays, 13:00 to 18:00" }), FIVE);
assert.deepEqual(col.timeSlots({ opens: "13:00", days: "" }), []);
assert.deepEqual(col.timeSlots({ days: "" }), []);
// old free text (what the preview point has today, and the usual ways of writing it)
for (const t of ["Saturdays, 13:00 to 18:00 (times to be confirmed)", "Saturdays 1pm to 6pm", "Sat 1PM - 6PM", "13:00-18:00", "Saturdays, 1pm until 6pm", "1:00pm to 6:00pm"]) {
  assert.deepEqual(col.timeSlots({ days: t }), FIVE, t);
}
assert.deepEqual(col.timeSlots({ days: "Saturdays, 10am to 1pm" }), ["10am to 11am", "11am to 12pm", "12pm to 1pm"]);
assert.deepEqual(col.timeSlots({ days: "10-1pm" }), ["10am to 11am", "11am to 12pm", "12pm to 1pm"]);
// text that is not clearly a time range gives no chips
for (const t of ["Saturdays", "Saturdays, 2 to 5", "Opens 26 to 28 Nov", "6pm to 1pm", "by arrangement", "13:00"]) assert.deepEqual(col.timeSlots({ days: t }), [], t);
assert.equal(col.hoursCaveat("Saturdays, 13:00 to 18:00 (times to be confirmed)"), "Times to be confirmed.");
assert.equal(col.hoursCaveat("Saturdays, 13:00 to 18:00"), "");

// the Worker: old points (no opens/closes) still read, new ones keep valid hours, junk is dropped or refused
const kv = (v) => ({ get: async () => JSON.stringify(v), put: async () => {} });
const old = { id: "a", name: "N", area: "A", days: "Saturdays, 13:00 to 18:00", active: true };
const list = await store.readPickups(kv({ pickups: [old, { ...old, id: "b", opens: "13:00", closes: "18:00" }, { ...old, id: "c", opens: "18:00", closes: "13:00" }, { ...old, id: "d", opens: "1pm", closes: "6pm" }] }));
assert.equal(list[0].opens, undefined);
assert.deepEqual([list[1].opens, list[1].closes], ["13:00", "18:00"]);
assert.equal(list[2].opens, undefined, "closing before opening is dropped");
assert.equal(list[3].opens, undefined, "not HH:MM is dropped");
const ok = store.parsePickupInput({ name: "N", area: "A", days: "", opens: "13:00", closes: "18:00" });
assert.deepEqual([ok.opens, ok.closes], ["13:00", "18:00"]);
const none = store.parsePickupInput({ name: "N", area: "A", days: "x", opens: "", closes: "" });
assert.equal("opens" in none, false);
for (const bad of [{ opens: "13:00" }, { closes: "18:00" }, { opens: "18:00", closes: "13:00" }, { opens: "13:00", closes: "13:00" }, { opens: "1pm", closes: "6pm" }, { opens: 13, closes: 18 }]) {
  assert.throws(() => store.parsePickupInput({ name: "N", area: "A", ...bad }), (e) => e.status === 400, JSON.stringify(bad));
}
console.log("pickup-slots: all passed");
