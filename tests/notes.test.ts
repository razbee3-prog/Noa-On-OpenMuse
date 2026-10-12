import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDailyNote,
  type DailyNote,
  peopleNames,
  pruneOldNotes,
  rememberPerson,
  searchMemory,
} from "../apps/server/src/engine/notes.ts";
import { rememberLine } from "../apps/server/src/engine/soul-memory.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

test("daily notes are dated, per owner, and skip sensitive lines", async (t) => {
  const db = await store(t);
  await appendDailyNote(db, "a", "Asked about Q3 estimated taxes", "2026-10-01T09:30:00.000Z");
  await appendDailyNote(db, "a", "My password is hunter2", "2026-10-01T09:31:00.000Z");
  await appendDailyNote(db, "b", "Other person's note", "2026-10-01T09:32:00.000Z");
  const notes = await db.list<DailyNote>("a", "daily-notes");
  assert.deepEqual(notes, [
    {
      id: "2026-10-01",
      lines: ["09:30 Asked about Q3 estimated taxes"],
      updatedAt: notes[0]?.updatedAt,
    },
  ]);
});

test("people pages hold dated facts without duplicates and reject secrets", async (t) => {
  const db = await store(t);
  await rememberPerson(db, "a", "Dana Lee", "Accountant, handles quarterly estimates");
  const page = await rememberPerson(db, "a", "dana lee", "Accountant, handles quarterly estimates");
  assert.equal(page.facts.length, 1);
  assert.deepEqual(await peopleNames(db, "a"), ["Dana Lee"]);
  assert.deepEqual(await peopleNames(db, "b"), []);
  await assert.rejects(rememberPerson(db, "a", "Dana", "her card number is 4111 1111 1111 1111"));
});

test("search covers memory, people and notes for one owner only", async (t) => {
  const db = await store(t);
  await rememberLine(db, "a", "Preferences", "Wants estimated taxes paid from savings");
  await rememberPerson(db, "a", "Dana Lee", "Accountant for estimated taxes");
  await appendDailyNote(
    db,
    "a",
    "You said: pay estimated taxes on Sept 15",
    "2026-09-10T12:00:00.000Z",
  );
  await appendDailyNote(db, "b", "You said: estimated taxes for b", "2026-09-10T12:00:00.000Z");
  const hits = await searchMemory(db, "a", "estimated taxes");
  assert.deepEqual(hits.map((h) => h.source).sort(), [
    "MEMORY.md",
    "note 2026-09-10",
    "person: Dana Lee",
  ]);
  assert.ok(hits.every((h) => !h.text.includes(" for b")));
  assert.deepEqual(await searchMemory(db, "a", "xx"), []);
});

test("old daily notes are pruned", async (t) => {
  const db = await store(t);
  await appendDailyNote(db, "a", "old", "2026-01-01T00:00:00.000Z");
  await appendDailyNote(db, "a", "recent", "2026-10-01T00:00:00.000Z");
  await pruneOldNotes(db, "2026-10-09T00:00:00.000Z");
  assert.deepEqual(
    (await db.list<DailyNote>("a", "daily-notes")).map((n) => n.id),
    ["2026-10-01"],
  );
});
