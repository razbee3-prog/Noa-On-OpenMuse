import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { PlaidClient } from "../packages/integrations/src/plaid.ts";
import { config as baseConfig } from "./helpers/computer.ts";

const READ_ONLY_PATHS = new Set([
  "/link/token/create",
  "/link/token/get",
  "/item/public_token/exchange",
  "/accounts/balance/get",
  "/transactions/sync",
  "/item/remove",
]);
const calls: string[] = [];
const fakePlaid: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  calls.push(path);
  const body = JSON.parse(String(init?.body));
  const reply = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  switch (path) {
    case "/link/token/create":
      return reply({
        link_token: `link-${body.user.client_user_id}`,
        hosted_link_url: "https://hosted.plaid.com/link/test",
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      });
    case "/link/token/get":
      return reply({
        link_sessions: [
          {
            results: {
              item_add_results: [
                { public_token: "public-sandbox-1", institution: { name: "First Platypus Bank" } },
              ],
            },
          },
        ],
      });
    case "/item/public_token/exchange":
      return reply({ access_token: "access-sandbox-secret-token", item_id: "item-1" });
    case "/accounts/balance/get":
      return reply({
        accounts: [
          {
            account_id: "acc-1",
            name: "Plaid Checking",
            mask: "0000",
            type: "depository",
            subtype: "checking",
            balances: { available: 100, current: 110, iso_currency_code: "USD" },
          },
        ],
      });
    case "/transactions/sync":
      return reply({
        added: [
          {
            transaction_id: "t1",
            account_id: "acc-1",
            amount: 12.5,
            date: new Date().toISOString().slice(0, 10),
            name: "Coffee",
            pending: false,
            iso_currency_code: "USD",
            personal_finance_category: { primary: "FOOD_AND_DRINK" },
          },
          {
            transaction_id: "t2",
            account_id: "acc-1",
            amount: -500,
            date: new Date().toISOString().slice(0, 10),
            name: "Payroll",
            pending: false,
            iso_currency_code: "USD",
          },
        ],
        modified: [],
        removed: [],
        next_cursor: "cursor-1",
        has_more: false,
      });
    case "/item/remove":
      return reply({ request_id: "r" });
    default:
      return new Response(JSON.stringify({ error_code: "NOT_FOUND" }), { status: 404 });
  }
};

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "noa-plaid-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("a bank linked by one account shows in its Finance view and is invisible to another", async () => {
  const { app, auth } = await createApp(
    db,
    { ...baseConfig, dataDir: directory, encryptionKey: randomBytes(32).toString("base64") },
    {
      plaidClient: new PlaidClient({
        clientId: "client",
        secret: "secret",
        environment: "sandbox",
        fetch: fakePlaid,
      }),
    },
  );
  const alice = (await auth.issue("apple-alice", "member")).token;
  const bob = (await auth.issue("apple-bob", "member")).token;
  const post = (token: string, path: string) =>
    app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const get = async (token: string, path: string) =>
    (await app.request(path, { headers: { Authorization: `Bearer ${token}` } })).json();

  const connect = await post(alice, "/api/plaid/connect");
  assert.equal(connect.status, 200);
  assert.equal((await connect.json()).url, "https://hosted.plaid.com/link/test");
  assert.equal((await post(bob, "/api/plaid/complete")).status, 409, "bob has no pending link");
  const complete = await post(alice, "/api/plaid/complete");
  assert.equal(complete.status, 200);
  assert.deepEqual(
    { ...(await complete.json()), syncedAt: undefined },
    { institution: "First Platypus Bank", accounts: 1, transactions: 2, syncedAt: undefined },
  );

  const stored = await db.get<{ secret: string }>("apple-alice", "credentials", "plaid");
  assert.ok(stored && !stored.secret.includes("access-sandbox"), "access token is encrypted");

  const aliceAgent = await get(alice, "/api/agent");
  const finance = aliceAgent.artifacts.find((a: { id: string }) => a.id === "plaid-finance");
  assert.equal(finance.kind, "finance");
  assert.equal(finance.data.spending, 12.5);
  assert.equal(finance.data.income, 500);
  const bobAgent = await get(bob, "/api/agent");
  assert.ok(!bobAgent.artifacts.some((a: { id: string }) => a.id === "plaid-finance"));

  const aliceWorkspace = await get(alice, "/api/workspace");
  const bobWorkspace = await get(bob, "/api/workspace");
  const plaidOf = (w: { connections: { id: string; status: string; account?: string }[] }) =>
    w.connections.find((c) => c.id === "plaid");
  assert.equal(plaidOf(aliceWorkspace)?.status, "connected");
  assert.equal(plaidOf(aliceWorkspace)?.account, "First Platypus Bank");
  assert.equal(plaidOf(bobWorkspace)?.status, "disconnected");
  assert.equal((await post(bob, "/api/plaid/sync")).status, 409);

  assert.equal((await post(alice, "/api/plaid/disconnect")).status, 200);
  assert.equal(await db.get("apple-alice", "credentials", "plaid"), null);
  assert.ok(
    calls.every((path) => READ_ONLY_PATHS.has(path)),
    `only read-only endpoints: ${calls}`,
  );
});
