import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBrowserManager } from "../src/browser.ts";
import { createBrowserFixture, fixtureOrigin } from "./fixtures.ts";

test("agent browser actions: sign-in handoff, sensitive fields, reviewed sends, blocked pages, profile isolation", {
  timeout: 120_000,
}, async (t) => {
  const fixture = await createBrowserFixture();
  const dataDir = await mkdtemp(join(tmpdir(), "noa-browser-actions-"));
  let browser = await createBrowserManager({ dataDir }, fixture.createProxy);
  t.after(async () => {
    await browser.close();
    await fixture.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const alice = randomUUID();
  const bob = randomUUID();

  await browser.create(alice, `${fixtureOrigin}/inbox`);
  const login = await browser.act(alice, { type: "read" });
  assert.equal(new URL(login.url).pathname, "/login");
  assert.equal(login.signInRequired, true);
  assert.equal(login.blocked, false);
  await assert.rejects(browser.act(alice, { type: "type", field: "Password", text: "hunter2" }), {
    code: "SENSITIVE_FIELD",
  });
  await assert.rejects(browser.act(alice, { type: "click", target: "Sign in" }), {
    code: "REVIEW_REQUIRED",
  });

  // The user signs in through Take control (console input), not through agent actions.
  await browser.act(alice, { type: "type", field: "Email", text: "alice@example.com" });
  await browser.input(alice, { type: "key", key: "Enter" });
  const inbox = await browser.act(alice, { type: "read" });
  assert.equal(new URL(inbox.url).pathname, "/inbox");
  assert.equal(inbox.signInRequired, false);
  assert.match(inbox.text, /Dana Lee: Are we still on for lunch Thursday\?/);

  await browser.act(alice, { type: "type", field: "Message", text: "See you then" });
  await assert.rejects(
    browser.act(alice, { type: "type", field: "Message", text: "4111 1111 1111 1111" }),
    { code: "SENSITIVE_FIELD" },
  );
  await assert.rejects(browser.act(alice, { type: "type", field: "Card number", text: "x" }), {
    code: "SENSITIVE_FIELD",
  });
  await assert.rejects(browser.act(alice, { type: "click", target: "Send" }), {
    code: "REVIEW_REQUIRED",
  });
  assert.equal(fixture.paths.includes("/sent"), false, "nothing is sent without review");
  await browser.act(alice, { type: "click", target: "Send", reviewed: true });
  for (let i = 0; i < 20 && !fixture.paths.includes("/sent"); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fixture.paths.includes("/sent"), true, "the reviewed send runs");
  await browser.act(alice, { type: "scroll", direction: "down" });

  await browser.navigate(alice, `${fixtureOrigin}/blocked`);
  const blocked = await browser.act(alice, { type: "read" });
  assert.equal(blocked.blocked, true);
  await browser.act(alice, { type: "back" });

  // A restarted worker reopens the same profile still signed in.
  await browser.close();
  browser = await createBrowserManager({ dataDir }, fixture.createProxy);
  await browser.create(alice, `${fixtureOrigin}/inbox`);
  assert.equal(new URL((await browser.act(alice, { type: "read" })).url).pathname, "/inbox");

  // Another profile does not share the sign-in.
  await browser.create(bob, `${fixtureOrigin}/inbox`);
  assert.equal(new URL((await browser.act(bob, { type: "read" })).url).pathname, "/login");
});
