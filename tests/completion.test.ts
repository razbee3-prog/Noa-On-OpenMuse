import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { lateTasks, unmetChecks } from "../apps/server/src/engine/completion.ts";
import type { AgentNotification, AgentTask } from "../packages/domain/src/agent.ts";
import { browserFixture } from "./helpers/browser.ts";

test("a done claim needs every requirement met with evidence", () => {
  assert.deepEqual(
    unmetChecks([
      {
        requirement: "Find 2025 receipts",
        met: true,
        evidence: "search_mail newer_than:365d, 4 threads",
      },
      { requirement: "Total them", met: true, evidence: " " },
      { requirement: "Save a report", met: false, evidence: "artifact 12" },
    ]),
    ["Total them", "Save a report"],
  );
});

test("scheduled work is late only past the grace period", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const task = (id: string, nextRunAt: string, status = "scheduled") =>
    ({ id, nextRunAt, status }) as AgentTask;
  assert.deepEqual(
    lateTasks(
      [
        task("late", "2026-10-09T11:00:00Z"),
        task("grace", "2026-10-09T11:50:00Z"),
        task("done", "2026-10-09T10:00:00Z", "succeeded"),
      ],
      now,
    ).map((t) => t.id),
    ["late"],
  );
});

test("late work is flagged only if it is still late on the next check", async (t) => {
  const fixture = await browserFixture(t, () => ({ data: {} }));
  const server = await createApp(fixture.db, fixture.config);
  t.after(() => server.agent.stop());
  const owner = "late-owner";
  const task = await server.agent.createTask(owner, { title: "File taxes", prompt: "File taxes" });
  await fixture.db.compareAndSwap(
    owner,
    "tasks",
    task.id,
    {},
    {
      status: "scheduled",
      nextRunAt: new Date(Date.now() - 3600000).toISOString(),
    },
  );
  const notes = async () =>
    (await fixture.db.list<AgentNotification>(owner, "notifications")).filter((n) =>
      n.title.startsWith("Running late"),
    );
  await server.agent.auditLate();
  assert.equal((await notes()).length, 0);
  await server.agent.auditLate();
  await server.agent.auditLate();
  assert.deepEqual(
    (await notes()).map((n) => n.taskId),
    [task.id],
  );
});
