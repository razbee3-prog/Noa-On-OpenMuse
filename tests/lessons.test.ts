import assert from "node:assert/strict";
import test from "node:test";
import {
  type Feedback,
  lessonsContext,
  loadLessons,
  looksLikeCorrection,
  recordFeedback,
  reviewDueLessons,
} from "../apps/server/src/engine/lessons.ts";
import { personaContext } from "../apps/server/src/engine/soul-memory.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

test("corrections are recognised in plain words", () => {
  for (const text of [
    "That's wrong, those receipts are from 2023",
    "No, I meant last month",
    "You got that wrong",
    "wrong account",
  ])
    assert.ok(looksLikeCorrection(text), text);
  for (const text of ["Thanks!", "Find my receipts", "What's my balance?"])
    assert.ok(!looksLikeCorrection(text), text);
});

test("weekly review turns feedback into owner-scoped lessons and clears it", async (t) => {
  const db = await store(t);
  await recordFeedback(
    db,
    "a",
    "correction",
    "Person said: that's wrong, receipts were from 2023",
    "2026-10-01T00:00:00.000Z",
  );
  await recordFeedback(
    db,
    "a",
    "failure",
    "Find receipts: search timed out",
    "2026-10-02T00:00:00.000Z",
  );
  await recordFeedback(
    db,
    "a",
    "correction",
    "my card is 4111 1111 1111 1111",
    "2026-10-03T00:00:00.000Z",
  );
  const prompts: string[] = [];
  await reviewDueLessons(
    db,
    async (_system, user) => {
      prompts.push(user);
      return "- Search the last 90 days of mail for receipts unless a period is named.\n- Card 4111 1111 1111 1111\nnot a lesson";
    },
    Date.parse("2026-10-09T00:00:00Z"),
  );
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0]?.includes("search timed out"));
  assert.ok(!prompts[0]?.includes("4111"));
  assert.deepEqual(await loadLessons(db, "a"), [
    "Search the last 90 days of mail for receipts unless a period is named.",
  ]);
  assert.deepEqual(await loadLessons(db, "b"), []);
  assert.deepEqual(await db.list<Feedback>("a", "feedback"), []);
  assert.match(await personaContext(db, "a"), /Lessons from past mistakes[\s\S]*90 days/);
});

test("no review within a week of the last one", async (t) => {
  const db = await store(t);
  await recordFeedback(db, "a", "failure", "first", "2026-10-01T00:00:00.000Z");
  let calls = 0;
  const summarize = async () => {
    calls++;
    return "- Lesson";
  };
  await reviewDueLessons(db, summarize, Date.parse("2026-10-02T00:00:00Z"));
  await recordFeedback(db, "a", "failure", "second", "2026-10-03T00:00:00.000Z");
  await reviewDueLessons(db, summarize, Date.parse("2026-10-04T00:00:00Z"));
  assert.equal(calls, 1);
  await reviewDueLessons(db, summarize, Date.parse("2026-10-10T00:00:00Z"));
  assert.equal(calls, 2);
  assert.equal(lessonsContext([]), "");
});
