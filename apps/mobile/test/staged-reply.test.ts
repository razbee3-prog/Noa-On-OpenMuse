import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableBubbles,
  FIRST_BUBBLE_DELAY,
  NEXT_BUBBLE_DELAY,
  nextReveal,
} from "../src/staged-reply.ts";

test("a streaming reply holds back its unfinished last bubble", () => {
  assert.equal(availableBubbles(3, true), 2);
  assert.equal(availableBubbles(1, true), 0);
  assert.equal(availableBubbles(0, true), 0);
  assert.equal(availableBubbles(3, false), 3);
});

test("bubbles reveal one at a time with a one-second pause after the first", () => {
  assert.deepEqual(nextReveal([{ id: "a", available: 3, shown: 0 }]), {
    id: "a",
    delay: FIRST_BUBBLE_DELAY,
  });
  assert.deepEqual(nextReveal([{ id: "a", available: 3, shown: 1 }]), {
    id: "a",
    delay: NEXT_BUBBLE_DELAY,
  });
  assert.equal(nextReveal([{ id: "a", available: 3, shown: 3 }]), undefined);
});

test("a later message waits for the earlier one and keeps the pause", () => {
  assert.deepEqual(
    nextReveal([
      { id: "a", available: 2, shown: 2 },
      { id: "b", available: 2, shown: 0 },
    ]),
    { id: "b", delay: NEXT_BUBBLE_DELAY },
  );
  assert.deepEqual(
    nextReveal([
      { id: "a", available: 2, shown: 1 },
      { id: "b", available: 2, shown: 0 },
    ])?.id,
    "a",
  );
});
