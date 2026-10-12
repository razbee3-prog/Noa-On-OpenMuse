import assert from "node:assert/strict";
import test from "node:test";
import {
  listSpecialists,
  specialistContext,
  specialistRequestSchema,
  startSpecialist,
} from "../apps/server/src/engine/specialists.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

test("a preset specialist opens one side chat per owner with its own instructions", async (t) => {
  const db = await store(t);
  const first = await startSpecialist(db, "a", { preset: "refund-tracker" });
  const again = await startSpecialist(db, "a", { preset: "refund-tracker" });
  assert.equal(again.id, first.id);
  assert.equal(first.name, "Refund tracker");
  assert.equal(first.mascot, "mint");
  const context = await specialistContext(db, "a", first.id);
  assert.match(context, /Refund tracker/);
  assert.match(context, /safety rule above still apply/);
  assert.equal(await specialistContext(db, "a", "some-other-thread"), "");
});

test("specialists stay owner-scoped", async (t) => {
  const db = await store(t);
  const mine = await startSpecialist(db, "a", { preset: "bill-negotiator" });
  const theirs = await startSpecialist(db, "b", { preset: "bill-negotiator" });
  assert.notEqual(mine.id, theirs.id);
  assert.equal(await specialistContext(db, "b", mine.id), "");
  assert.deepEqual(
    (await listSpecialists(db, "a")).map((item) => item.id),
    [mine.id],
  );
});

test("custom specialists get a name, a short blurb and a rotating look", async (t) => {
  const db = await store(t);
  const one = await startSpecialist(
    db,
    "a",
    specialistRequestSchema.parse({
      name: "Travel points",
      instructions: "Track my airline points. Tell me before any expire.",
    }),
  );
  const two = await startSpecialist(db, "a", { name: "Rent", instructions: "Watch my lease." });
  assert.equal(one.blurb, "Track my airline points.");
  assert.notEqual(one.mascot, two.mascot);
  assert.equal((await listSpecialists(db, "a")).length, 2);
});

test("specialist requests reject unknown presets and empty jobs", () => {
  assert.throws(() => specialistRequestSchema.parse({ preset: "stock-picker" }));
  assert.throws(() => specialistRequestSchema.parse({ name: "x", instructions: "  " }));
});
