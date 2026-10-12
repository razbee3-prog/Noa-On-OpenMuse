import assert from "node:assert/strict";
import test from "node:test";
import { clockContext } from "../apps/server/src/engine/clock.ts";

test("clock context states today's date in the person's time zone", () => {
  const now = new Date("2026-10-12T16:30:00Z");
  const text = clockContext(now, "America/New_York");
  assert.match(text, /Monday, October 12, 2026/);
  assert.match(text, /12:30 PM EDT/);
  assert.match(text, /2026-10-12T16:30:00\.000Z/);
  assert.match(text, /newer_than:90d/);
});

test("clock context falls back to UTC for a missing or invalid zone", () => {
  const now = new Date("2026-01-01T03:00:00Z");
  assert.match(clockContext(now), /January 1, 2026.*UTC/);
  assert.match(clockContext(now, "Not/AZone"), /UTC/);
  assert.match(clockContext(now, "x'); drop"), /UTC/);
});
