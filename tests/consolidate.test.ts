import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptConsolidation,
  consolidateDueMemories,
} from "../apps/server/src/engine/consolidate.ts";
import { appendDailyNote } from "../apps/server/src/engine/notes.ts";
import {
  emptyMemory,
  loadMemory,
  rememberLine,
  saveFile,
} from "../apps/server/src/engine/soul-memory.ts";
import type { AgentFile } from "../packages/domain/src/agent.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

const BEFORE = emptyMemory(["Accountant is Sam (2026-09-01)", "Lives in NYC (2026-09-01)"]);

test("only a complete, safe, non-destructive file is accepted", () => {
  const good = BEFORE.replace("Sam (2026-09-01)", "Priya (2026-10-12)");
  assert.equal(acceptConsolidation(BEFORE, `\`\`\`markdown\n${good}\`\`\``), good);
  assert.equal(acceptConsolidation(BEFORE, good.replace("## Preferences\n", "")), undefined);
  assert.equal(acceptConsolidation(BEFORE, "Sure! Here is the file."), undefined);
  assert.equal(acceptConsolidation(BEFORE, emptyMemory()), undefined);
  const leaky = good.replace("## Preferences\n", "## Preferences\n- Card 4111 1111 1111 1111\n");
  assert.equal(acceptConsolidation(BEFORE, leaky), good);
});

test("nightly pass folds recent notes into memory once, per owner", async (t) => {
  const db = await store(t);
  await rememberLine(db, "a", "Facts", "Accountant is Sam");
  await loadMemory(db, "b");
  await appendDailyNote(db, "a", "You said: my accountant is Priya now");
  await appendDailyNote(db, "a", "You said: my one-time code is 123456");
  const prompts: string[] = [];
  const summarize = async (_system: string, user: string) => {
    prompts.push(user);
    return emptyMemory(["Accountant is Priya (2026-10-12)"]);
  };
  await consolidateDueMemories(db, summarize);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0]?.includes("accountant is Priya"));
  assert.ok(!prompts[0]?.includes("123456"));
  const a = await loadMemory(db, "a");
  assert.match(a.text, /Accountant is Priya/);
  assert.doesNotMatch(a.text, /Sam/);
  assert.equal(a.updatedBy, "noa");
  assert.ok((await loadMemory(db, "b")).lastConsolidatedAt);
  await consolidateDueMemories(db, summarize, Date.now() + 3600000);
  await consolidateDueMemories(db, summarize, Date.now() + 21 * 3600000);
  assert.equal(prompts.length, 1);
});

test("an edit made during the pass is never overwritten", async (t) => {
  const db = await store(t);
  await loadMemory(db, "a");
  await appendDailyNote(db, "a", "You said: I moved to Boston");
  await consolidateDueMemories(db, async () => {
    await saveFile(db, "a", "memory-file", emptyMemory(["Typed by me"]), "you");
    return emptyMemory(["Lives in Boston (2026-10-12)"]);
  });
  const a = (await db.get<AgentFile>("a", "agent-settings", "memory-file")) as AgentFile;
  assert.match(a.text, /Typed by me/);
  assert.equal(a.lastConsolidatedAt, undefined);
});
