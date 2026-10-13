import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTask } from "../../../packages/domain/src/agent.ts";
import { nextRunLabel, routineStatus } from "../src/routine-label.ts";

function task(patch: Partial<AgentTask>): AgentTask {
  return {
    id: "t",
    title: "Cancel Hulu",
    prompt: "Cancel Hulu",
    kind: "agent",
    status: "queued",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    attempts: 0,
    leaseId: null,
    leaseUntil: null,
    artifactIds: [],
    ...patch,
  };
}

test("the header names the routine Noa is running", () => {
  assert.equal(routineStatus([task({ status: "running" })]), "Working on · Cancel Hulu");
  assert.equal(
    routineStatus([task({ status: "scheduled", state: { quietRetries: 1 } })]),
    "Working on · Cancel Hulu",
    "a quiet retry still reads as working",
  );
  assert.equal(routineStatus([task({ status: "queued" })]), "Starting · Cancel Hulu");
  assert.equal(
    routineStatus([
      task({ status: "running", title: "Check bills" }),
      task({ status: "waiting_approval" }),
    ]),
    "Ready to review · Cancel Hulu",
    "needing the person comes first",
  );
  assert.equal(routineStatus([task({ status: "scheduled" }), task({ status: "succeeded" })]), "");
});

test("scheduled routines say when they run next and how often", () => {
  const now = new Date(2026, 9, 13, 8, 0).getTime();
  const at = (days: number, hour: number) => new Date(2026, 9, 13 + days, hour, 0).toISOString();
  assert.equal(
    nextRunLabel(
      task({
        status: "scheduled",
        kind: "reminder",
        nextRunAt: at(0, 17),
        input: { repeat: "none" },
      }),
      now,
    ),
    "Next: today 5:00 PM",
  );
  assert.equal(
    nextRunLabel(
      task({
        status: "scheduled",
        kind: "reminder",
        nextRunAt: at(1, 9),
        input: { repeat: "daily" },
      }),
      now,
    ),
    "Next: tomorrow 9:00 AM · every day",
  );
  assert.match(
    nextRunLabel(
      task({
        status: "scheduled",
        kind: "monitor",
        nextRunAt: at(3, 9),
        input: { intervalMinutes: 120 },
      }),
      now,
    ),
    /^Next: \w{3} 9:00 AM · every 2 hours$/,
  );
  assert.equal(nextRunLabel(task({ status: "running", nextRunAt: at(0, 9) }), now), "");
  assert.equal(
    nextRunLabel(
      task({ status: "scheduled", nextRunAt: at(0, 9), state: { quietRetries: 2 } }),
      now,
    ),
    "",
    "a quiet retry is not a schedule",
  );
});
