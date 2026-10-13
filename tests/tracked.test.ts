import assert from "node:assert/strict";
import test from "node:test";
import {
  claimDueTracked,
  closeTracked,
  listTracked,
  trackItem,
} from "../apps/server/src/engine/tracked.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

test("updates with the same title build one owner-scoped timeline", async (t) => {
  const db = await store(t);
  await trackItem(
    db,
    "a",
    {
      kind: "refund",
      title: "Delta refund",
      update: "Requested",
      dueAt: "2026-10-20T00:00:00.000Z",
    },
    "2026-10-10T00:00:00.000Z",
  );
  const item = await trackItem(
    db,
    "a",
    { kind: "refund", title: "delta  refund", update: "Delta confirmed it" },
    "2026-10-12T00:00:00.000Z",
  );
  assert.ok(!("error" in item));
  assert.deepEqual(
    item.timeline.map((e) => e.text),
    ["Requested", "Delta confirmed it"],
  );
  assert.equal(item.dueAt, "2026-10-20T00:00:00.000Z", "an update keeps the due date");
  assert.equal((await listTracked(db, "a")).length, 1);
  assert.deepEqual(await listTracked(db, "b"), [], "other people never see it");
  const done = await closeTracked(db, "a", item.id, "2026-10-13T00:00:00.000Z");
  assert.equal(done.status, "done");
  assert.equal(done.timeline.at(-1)?.text, "Marked done");
  await assert.rejects(closeTracked(db, "b", item.id));
});

test("card numbers are refused", async (t) => {
  const db = await store(t);
  const result = await trackItem(db, "a", {
    kind: "bill",
    title: "Card bill",
    update: "Card 4111 1111 1111 1111 due",
  });
  assert.ok("error" in result);
  assert.deepEqual(await listTracked(db, "a"), []);
});

test("an overdue item is flagged once and old finished items are dropped", async (t) => {
  const db = await store(t);
  await trackItem(
    db,
    "a",
    { kind: "delivery", title: "Desk", update: "Shipped", dueAt: "2026-10-12T00:00:00.000Z" },
    "2026-10-10T00:00:00.000Z",
  );
  const now = Date.parse("2026-10-13T00:00:00.000Z");
  const due = await claimDueTracked(db, now);
  assert.deepEqual(
    due.map((d) => [d.owner, d.item.title, d.text]),
    [["a", "Desk", "This should have arrived by now. Did it come?"]],
  );
  assert.deepEqual(await claimDueTracked(db, now + 60000), [], "only once");
  const [item] = await listTracked(db, "a");
  await closeTracked(db, "a", item.id, "2026-10-13T00:00:00.000Z");
  await claimDueTracked(db, Date.parse("2026-12-01T00:00:00.000Z"));
  assert.deepEqual(await listTracked(db, "a"), []);
});
