import assert from "node:assert/strict";
import test from "node:test";
import { nextTier, taskModel } from "../apps/server/src/engine/models.ts";

const config = { model: "anthropic/claude-sonnet-5-5", modelDeep: "anthropic/claude-opus-5-5" };

test("tasks start on the main model and move up once", () => {
  assert.deepEqual(taskModel(config, undefined), { model: config.model, tier: "main" });
  assert.equal(nextTier(config, "main"), "deep");
  assert.deepEqual(taskModel(config, "deep"), { model: config.modelDeep, tier: "deep" });
  assert.equal(nextTier(config, "deep"), undefined);
});

test("without a deep model there is nothing to move up to", () => {
  const plain = { model: config.model };
  assert.deepEqual(taskModel(plain, "deep"), { model: config.model, tier: "main" });
  assert.equal(nextTier(plain, "main"), undefined);
  assert.equal(nextTier({ model: config.model, modelDeep: config.model }, "main"), undefined);
});
