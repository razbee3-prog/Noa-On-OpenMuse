import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPlaybooks,
  playbooksContext,
  recordFinishedJob,
  reviewDuePlaybooks,
} from "../apps/server/src/engine/playbooks.ts";
import { personaContext } from "../apps/server/src/engine/soul-memory.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";
import { browserFixture } from "./helpers/browser.ts";

async function store(t: test.TestContext) {
  return (await browserFixture(t, () => ({ data: {} }))).db;
}

function job(id: string, title: string, steps: string[], at: string): AgentTask {
  return {
    id,
    title,
    prompt: title,
    kind: "agent",
    status: "succeeded",
    plan: steps.map((s, i) => ({ id: `${id}-${i}`, title: s, status: "succeeded" })),
    evidence: [],
    input: {},
    state: {},
    createdAt: at,
    updatedAt: at,
    attempts: 1,
    leaseId: null,
    leaseUntil: null,
    artifactIds: [],
  } as unknown as AgentTask;
}

const reply =
  "## Cancel a subscription\n- Find the latest receipt in mail\n- Open the account page in the browser\n- Prepare the cancel step for review\n## One-off\n- only one step";

test("repeated jobs become owner-scoped playbooks that Noa reads", async (t) => {
  const db = await store(t);
  const steps = ["Find the receipt", "Open account page", "Prepare cancel for review"];
  await recordFinishedJob(db, "a", job("1", "Cancel Hulu", steps, "2026-10-01T00:00:00.000Z"));
  await recordFinishedJob(db, "a", job("2", "Cancel Peacock", steps, "2026-10-05T00:00:00.000Z"));
  const prompts: string[] = [];
  await reviewDuePlaybooks(
    db,
    async (_system, user) => {
      prompts.push(user);
      return reply;
    },
    Date.parse("2026-10-06T00:00:00.000Z"),
  );
  assert.match(prompts[0], /Cancel Hulu[\s\S]*Cancel Peacock/);
  const items = await loadPlaybooks(db, "a");
  assert.deepEqual(
    items.map((p) => p.title),
    ["Cancel a subscription"],
    "a playbook needs at least two steps",
  );
  assert.deepEqual(await loadPlaybooks(db, "b"), [], "other people never see it");
  assert.match(
    await personaContext(db, "a"),
    /Cancel a subscription:\n {2}1\. Find the latest receipt/,
  );
  assert.doesNotMatch(await personaContext(db, "b"), /Playbooks/);
});

test("one job, short jobs, reminders and sensitive jobs never become playbooks", async (t) => {
  const db = await store(t);
  let calls = 0;
  const summarize = async () => {
    calls++;
    return reply;
  };
  await recordFinishedJob(
    db,
    "a",
    job("1", "Quick look", ["One step"], "2026-10-01T00:00:00.000Z"),
  );
  await recordFinishedJob(db, "a", {
    ...job("2", "Remind me", ["a", "b"], "2026-10-01T00:00:00.000Z"),
    kind: "reminder",
  });
  await recordFinishedJob(
    db,
    "a",
    job("3", "Pay card 4111 1111 1111 1111", ["a", "b"], "2026-10-01T00:00:00.000Z"),
  );
  await recordFinishedJob(db, "a", job("4", "Cancel Hulu", ["a", "b"], "2026-10-01T00:00:00.000Z"));
  await reviewDuePlaybooks(db, summarize, Date.parse("2026-10-02T00:00:00.000Z"));
  assert.equal(calls, 0, "a single finished job is not reviewed");
});

test("the review runs about once a day and old jobs are dropped", async (t) => {
  const db = await store(t);
  let calls = 0;
  const summarize = async () => {
    calls++;
    return reply;
  };
  for (const id of ["1", "2"])
    await recordFinishedJob(db, "a", job(id, "Cancel", ["a", "b"], "2026-10-01T00:00:00.000Z"));
  await reviewDuePlaybooks(db, summarize, Date.parse("2026-10-02T00:00:00.000Z"));
  await reviewDuePlaybooks(db, summarize, Date.parse("2026-10-02T05:00:00.000Z"));
  assert.equal(calls, 1);
  await reviewDuePlaybooks(db, summarize, Date.parse("2026-12-15T00:00:00.000Z"));
  assert.equal(calls, 1, "jobs older than 60 days are dropped, not reviewed");
  assert.equal(playbooksContext([]), "");
});
