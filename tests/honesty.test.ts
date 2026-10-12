import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { honestyRules } from "../apps/server/src/engine/honesty.ts";
import { DEFAULT_SOUL } from "../apps/server/src/engine/soul-memory.ts";

test("honesty rules cover verification, owned mistakes, no substitution and no blind retries", () => {
  for (const phrase of [
    "check the live source",
    "which parts you verified",
    "I couldn't verify",
    "I got that wrong",
    "Never swap in a different",
    "say what you tried",
    "after remember_fact returns saved",
    "never repeat it blindly",
    "fix it everywhere",
  ])
    assert.ok(honestyRules.includes(phrase), phrase);
});

test("chat and delegated tasks both use the honesty rules", () => {
  for (const file of ["conversation.ts", "model.ts"]) {
    const source = readFileSync(
      new URL(`../apps/server/src/engine/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /import \{ honestyRules \} from "\.\/honesty\.ts"/, file);
    assert.match(source, /\$\{honestyRules\}|honestyRules \+/, file);
  }
});

test("new Soul files start with the honesty habit", () => {
  assert.match(DEFAULT_SOUL, /Be honest about what you know/);
  assert.match(DEFAULT_SOUL, /I couldn't verify/);
});
