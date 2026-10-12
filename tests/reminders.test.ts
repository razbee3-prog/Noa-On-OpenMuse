import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { AgentNotification } from "../packages/domain/src/agent.ts";
import { browserFixture } from "./helpers/browser.ts";

async function setup(t: test.TestContext) {
  const fixture = await browserFixture(t, () => ({ data: {} }));
  const server = await createApp(fixture.db, fixture.config);
  t.after(() => server.agent.stop());
  return { db: fixture.db, agent: server.agent };
}

test("a reminder is a scheduled record that notifies once when due", async (t) => {
  const { db, agent } = await setup(t);
  const owner = "reminder-user";
  const later = new Date(Date.now() + 3600000).toISOString();
  const future = await agent.createTask(owner, {
    kind: "reminder",
    title: "Reminder: call the CPA",
    prompt: "Call the CPA about Q3 estimates",
    input: { at: later },
  });
  assert.equal(future.status, "scheduled");
  assert.equal(future.nextRunAt, later);

  const due = await agent.createTask(owner, {
    kind: "reminder",
    title: "Reminder: pay rent",
    prompt: "Pay rent",
    input: { at: new Date(Date.now() - 1000).toISOString() },
  });
  await agent.worker.tick();
  assert.equal((await agent.getTask(owner, due.id)).status, "succeeded");
  assert.equal((await agent.getTask(owner, future.id)).status, "scheduled");
  const notes = await db.list<AgentNotification>(owner, "notifications");
  assert.deepEqual(
    notes.filter((n) => n.taskId === due.id).map((n) => n.body),
    ["Pay rent"],
  );
  assert.equal(notes.filter((n) => n.taskId === future.id).length, 0);
});

test("a repeating reminder notifies and schedules its next time", async (t) => {
  const { db, agent } = await setup(t);
  const owner = "repeat-user";
  const task = await agent.createTask(owner, {
    kind: "reminder",
    title: "Reminder: log expenses",
    prompt: "Log this week's expenses",
    input: { at: new Date(Date.now() - 1000).toISOString(), repeat: "weekly" },
  });
  await agent.worker.tick();
  const after = await agent.getTask(owner, task.id);
  assert.equal(after.status, "scheduled");
  assert.ok(Date.parse(after.nextRunAt ?? "") > Date.now() + 6 * 86400000);
  const notes = await db.list<AgentNotification>(owner, "notifications");
  assert.equal(notes.filter((n) => n.taskId === task.id).length, 1);
});

test("reminders need a valid time", async (t) => {
  const { agent } = await setup(t);
  await assert.rejects(
    agent.createTask("bad-user", { kind: "reminder", prompt: "x", input: { at: "tomorrow" } }),
  );
});
