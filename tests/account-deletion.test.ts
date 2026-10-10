import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { config as baseConfig } from "./helpers/computer.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "noa-delete-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("deleting an account removes its data and sessions but not other accounts'", async () => {
  const { app, auth } = await createApp(db, {
    ...baseConfig,
    dataDir: directory,
    computerEnabled: false,
  });
  for (const owner of ["apple-carol", "apple-dave"]) {
    await db.put("system", "accounts", {
      id: owner,
      provider: "apple",
      displayName: owner,
      createdAt: new Date().toISOString(),
    });
    await db.put(owner, "memories", { id: "m1", text: `${owner} likes tea` });
    await db.put(owner, "tasks", { id: "t1", title: "Task" });
  }
  const carol = (await auth.issue("apple-carol", "member")).token;
  const carolSecond = (await auth.issue("apple-carol", "member")).token;
  const dave = (await auth.issue("apple-dave", "member")).token;
  const admin = (await auth.issue("local-user", "admin")).token;
  const call = (token: string, method = "GET") =>
    app.request("/api/account", { method, headers: { Authorization: `Bearer ${token}` } });

  assert.equal((await call(admin, "DELETE")).status, 403, "admin workspace is protected");
  const deleted = await call(carol, "DELETE");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  assert.equal(await db.get("system", "accounts", "apple-carol"), null);
  assert.deepEqual(await db.list("apple-carol", "memories"), []);
  assert.deepEqual(await db.list("apple-carol", "tasks"), []);
  assert.equal((await call(carol)).status, 401, "current session revoked");
  assert.equal((await call(carolSecond)).status, 401, "every session revoked");

  assert.equal((await db.list("apple-dave", "memories")).length, 1);
  assert.ok(await db.get("system", "accounts", "apple-dave"));
  assert.equal((await call(dave)).status, 200);
});
