import assert from "node:assert/strict";
import test from "node:test";
import type { TrackedItem } from "../../../packages/domain/src/agent.ts";
import { trackedSubtitle } from "../src/routine-label.ts";

const now = Date.parse("2026-10-13T12:00:00");
const item = (over: Partial<TrackedItem>): TrackedItem => ({
  id: "delivery:desk",
  kind: "delivery",
  title: "Standing desk",
  status: "open",
  timeline: [{ at: "2026-10-12T10:00:00", text: "Shipped" }],
  createdAt: "2026-10-12T10:00:00",
  updatedAt: "2026-10-12T10:00:00",
  ...over,
});

test("tracked items show kind, due time and the latest update", () => {
  assert.equal(
    trackedSubtitle(item({ dueAt: "2026-10-14T17:00:00" }), now),
    "Delivery · Due tomorrow 5:00 PM · Shipped",
  );
  assert.equal(
    trackedSubtitle(item({ dueAt: "2026-10-12T17:00:00" }), now),
    "Delivery · Overdue · Shipped",
  );
  assert.equal(trackedSubtitle(item({ kind: "refund" }), now), "Refund · Shipped");
  assert.equal(trackedSubtitle(item({ status: "done" }), now), "Delivery · Done");
});
