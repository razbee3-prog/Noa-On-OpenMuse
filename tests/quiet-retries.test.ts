import assert from "node:assert/strict";
import { test } from "node:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createStore } from "../apps/server/src/db.ts";
import { TaskWorker } from "../apps/server/src/engine/worker.ts";
import { RetryingIntelligence } from "../apps/server/src/intelligence.ts";
import { isTransient, withRetries } from "../apps/server/src/retry.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

const outage = Object.assign(new Error("Intelligence platform error 502: <html>"), { status: 502 });

function task(): AgentTask {
  return {
    id: "task1",
    title: "Check a source",
    prompt: "Check a source",
    kind: "agent",
    status: "queued",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    leaseId: null,
    leaseUntil: null,
    artifactIds: [],
  };
}

test("only passing outages count as transient", () => {
  assert.equal(isTransient(outage), true);
  assert.equal(isTransient(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isTransient(new TypeError("fetch failed")), true);
  assert.equal(isTransient(new Error("Overloaded")), true);
  assert.equal(isTransient(Object.assign(new Error("Thread not found"), { status: 404 })), false);
  assert.equal(isTransient(new Error("The CSV has no amount column")), false);
});

test("withRetries retries a passing outage three times, then gives up", async () => {
  let calls = 0;
  assert.equal(
    await withRetries(async () => (++calls < 3 ? Promise.reject(outage) : "ok"), [0, 0, 0]),
    "ok",
  );
  calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls++;
      throw outage;
    }, [0, 0, 0]),
  );
  assert.equal(calls, 4, "first try plus three retries");
  calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls++;
      throw Object.assign(new Error("Thread not found"), { status: 404 });
    }, [0, 0, 0]),
  );
  assert.equal(calls, 1, "a real error is not retried");
});

test("a 502 from the thread service is retried before it reaches the app", async (t) => {
  RetryingIntelligence.delays = [0, 0, 0];
  let calls = 0;
  t.mock.method(CopilotKitIntelligence.prototype, "getThread", async () => {
    if (++calls < 3) throw outage;
    return { id: "thread" };
  });
  const intelligence = new RetryingIntelligence({ apiKey: "test-key-never-sent" });
  assert.deepEqual(await intelligence.getThread({ threadId: "thread", userId: "u" }), {
    id: "thread",
  });
  assert.equal(calls, 3);
});

test("a background task that hits an outage is retried quietly, and fails only after three retries", async () => {
  const db = await createStore();
  try {
    await db.put("owner", "tasks", task());
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    let runs = 0;
    const worker = new TaskWorker(
      db,
      async () => {
        runs++;
        throw outage;
      },
      { now: () => clock },
    );
    for (let retry = 1; retry <= 3; retry++) {
      await worker.tick();
      const saved = await db.get<AgentTask>("owner", "tasks", "task1");
      assert.equal(saved?.status, "scheduled");
      assert.equal(saved?.state.quietRetries, retry);
      assert.equal(saved?.error, undefined, "nothing is shown while retrying");
      clock = Date.parse(saved?.nextRunAt ?? "") + 1;
    }
    await worker.tick();
    const failed = await db.get<AgentTask>("owner", "tasks", "task1");
    assert.equal(failed?.status, "failed");
    assert.equal(runs, 4);
  } finally {
    await db.close();
  }
});

test("a task that fails for a real reason is not retried", async () => {
  const db = await createStore();
  try {
    await db.put("owner", "tasks", task());
    await new TaskWorker(db, async () => {
      throw new Error("The CSV has no amount column");
    }).tick();
    assert.equal((await db.get<AgentTask>("owner", "tasks", "task1"))?.status, "failed");
  } finally {
    await db.close();
  }
});
