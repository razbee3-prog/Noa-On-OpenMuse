import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { connectorReadTools } from "../apps/server/src/connector-tools.ts";
import { ConnectorService, NANGO_CAP_MESSAGE } from "../apps/server/src/connectors.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { ActionProposal } from "../packages/domain/src/index.ts";
import { NangoClient } from "../packages/integrations/src/nango.ts";
import { config as baseConfig } from "./helpers/computer.ts";

const approvedConfig = {
  ...baseConfig,
  nango: {
    secretKey: "test",
    baseUrl: "http://nango.test",
    approvedConnectors: ["quickbooks", "gusto"],
  },
};

const PROVIDERS = [
  "outlook",
  "slack",
  "microsoft-teams",
  "jira",
  "quickbooks-sandbox",
  "stripe-api-key",
  "gusto-demo",
];

interface FakeConnection {
  connection_id: string;
  provider_config_key: string;
  tags: Record<string, string>;
  end_user: { id: string; email: string };
}
interface ProxyCall {
  connectionId: string;
  key: string;
  method: string;
  path: string;
}
let connections: FakeConnection[] = [];
let proxyCalls: ProxyCall[] = [];
let sessions: Record<string, unknown>[] = [];
let capped = false;

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const PROXY_DATA: Record<string, unknown> = {
  "/v1.0/me/messages": { value: [{ id: "m1", subject: "Q3 budget", bodyPreview: "Numbers" }] },
  "/v1.0/me/calendarView": { value: [{ id: "e1", subject: "Standup" }] },
  "/search.messages": { messages: { matches: [{ text: "launch is Friday" }] } },
  "/v1.0/me/chats": { value: [{ id: "c1", topic: "Design" }] },
  "/v1.0/me/joinedTeams": { value: [{ id: "t1", displayName: "Eng" }] },
  "/v1.0/teams/t1/channels": { value: [{ id: "ch1", displayName: "General" }] },
  "/oauth/token/accessible-resources": [
    { id: "cloud-1", url: "https://x.atlassian.net", name: "x" },
  ],
  "/ex/jira/cloud-1/rest/api/3/search/jql": {
    issues: [{ key: "NOA-1", fields: { summary: "Fix login" } }],
  },
  "/v3/company/realm-9/reports/ProfitAndLoss": {
    Header: { ReportName: "ProfitAndLoss" },
    Rows: { Row: [{ Summary: "Net Income 4200" }] },
  },
  "/v1/balance": { available: [{ amount: 12345, currency: "usd" }] },
  "/v1/me": {
    roles: { payroll_admin: { companies: [{ uuid: "co-1" }] }, employee: { uuid: "emp-1" } },
  },
  "/v1/companies/co-1/payrolls": [{ payroll_uuid: "p1", check_date: "2026-10-01" }],
  "/v1.0/me/sendMail": {},
  "/chat.postMessage": { ok: true, ts: "1.2" },
};

const fakeNango: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("authorization"), "Bearer nango-test-key");
  if (url.pathname === "/integrations")
    return reply({ data: PROVIDERS.map((p) => ({ unique_key: p, provider: p })) });
  if (url.pathname === "/connect/sessions") {
    const body = JSON.parse(String(init?.body));
    sessions.push(body);
    if (capped)
      return reply(
        { error: { code: "resource_capped", message: "Connection limit reached" } },
        400,
      );
    return reply(
      { data: { token: "tok", connect_link: "https://connect.nango.dev/?t=tok", expires_at: "x" } },
      201,
    );
  }
  // Deliberately ignores endUserId: the server must still filter by the owner tag itself.
  if (url.pathname === "/connections") return reply({ connections });
  const one = url.pathname.match(/^\/connection\/([^/]+)$/);
  if (one && method === "DELETE") {
    connections = connections.filter(
      (c) =>
        !(
          c.connection_id === decodeURIComponent(one[1]) &&
          c.provider_config_key === url.searchParams.get("provider_config_key")
        ),
    );
    return reply({ success: true });
  }
  if (one) return reply({ connection_config: { realmId: "realm-9" } });
  if (url.pathname.startsWith("/proxy/")) {
    const path = url.pathname.slice("/proxy".length);
    proxyCalls.push({
      connectionId: headers.get("connection-id") ?? "",
      key: headers.get("provider-config-key") ?? "",
      method,
      path,
    });
    return reply(PROXY_DATA[path] ?? {});
  }
  return reply({ error: "not found" }, 404);
};

const client = new NangoClient("nango-test-key", "https://nango.test", fakeNango);
const connect = (owner: string, key: string, email = `${owner}@example.com`) =>
  connections.push({
    connection_id: `conn-${owner}-${key}`,
    provider_config_key: key,
    tags: { end_user_id: NangoClient.endUserId(owner) },
    end_user: { id: NangoClient.endUserId(owner), email },
  });

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "noa-connectors-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
  connections = [];
  proxyCalls = [];
  sessions = [];
  capped = false;
});

async function setup() {
  const { app, auth } = await createApp(
    db,
    { ...approvedConfig, dataDir: directory, encryptionKey: randomBytes(32).toString("base64") },
    { nangoClient: client },
  );
  const alice = (await auth.issue("apple-alice", "member")).token;
  const bob = (await auth.issue("apple-bob", "member")).token;
  const call = (token: string, path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, alice, bob, call };
}

const tool = (owner: string, name: string) => {
  const service = new ConnectorService(approvedConfig, client);
  const found = connectorReadTools(service, owner).find((t) => t.name === name);
  assert.ok(found, name);
  return found.execute as (
    args: unknown,
  ) => Promise<{ data?: unknown; error?: string; note?: string }>;
};

test("a Nango connection made by one account is invisible to and unusable by another", async () => {
  const { alice, bob, call } = await setup();
  connect("apple-alice", "outlook");

  const status = async (token: string) =>
    (await (await call(token, "/api/connectors")).json()) as {
      id: string;
      status: string;
      account?: string;
    }[];
  const aliceList = await status(alice);
  assert.deepEqual(
    aliceList.map((c) => c.id),
    ["outlook", "slack", "teams", "jira", "quickbooks", "stripe", "gusto"],
  );
  assert.equal(aliceList.find((c) => c.id === "outlook")?.status, "connected");
  assert.equal(aliceList.find((c) => c.id === "outlook")?.account, "apple-alice@example.com");
  assert.ok((await status(bob)).every((c) => c.status === "disconnected"));
  const bobWorkspace = await (await call(bob, "/api/workspace")).json();
  assert.equal(
    bobWorkspace.connections.find((c: { id: string }) => c.id === "outlook").status,
    "disconnected",
  );

  const bobRead = await tool("apple-bob", "search_outlook_mail")({ query: "budget", limit: 5 });
  assert.match(bobRead.error ?? "", /not connected/);
  assert.equal(proxyCalls.length, 0, "bob never reaches Alice's connection");

  assert.equal((await call(bob, "/api/connectors/outlook/disconnect", "POST")).status, 200);
  assert.equal(connections.length, 1, "bob's disconnect leaves Alice's connection alone");

  const started = await call(bob, "/api/connectors/outlook/connect", "POST", {
    connectionId: "conn-apple-alice-outlook",
    endUserId: NangoClient.endUserId("apple-alice"),
  });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).url, "https://connect.nango.dev/?t=tok");
  assert.deepEqual(sessions[0].tags, { end_user_id: NangoClient.endUserId("apple-bob") });
  assert.deepEqual(sessions[0].allowed_integrations, ["outlook"]);

  const aliceRead = await tool("apple-alice", "search_outlook_mail")({ query: "budget", limit: 5 });
  assert.deepEqual(proxyCalls, [
    {
      connectionId: "conn-apple-alice-outlook",
      key: "outlook",
      method: "GET",
      path: "/v1.0/me/messages",
    },
  ]);
  assert.match(JSON.stringify(aliceRead.data), /Q3 budget/);
  assert.match(aliceRead.note ?? "", /evidence/);

  assert.equal((await call(alice, "/api/connectors/outlook/disconnect", "POST")).status, 200);
  assert.equal(connections.length, 0);
  assert.equal(
    await db.get("apple-alice", "credentials", "outlook"),
    null,
    "no tokens in Postgres",
  );
});

test("deleting an account deletes all of its Nango connections and nobody else's", async () => {
  const { alice, call } = await setup();
  connect("apple-alice", "outlook");
  connect("apple-alice", "slack");
  connect("apple-bob", "slack");
  assert.equal((await call(alice, "/api/account", "DELETE")).status, 200);
  assert.deepEqual(
    connections.map((c) => c.connection_id),
    ["conn-apple-bob-slack"],
  );
});

test("the free-plan connection cap shows a clear message", async () => {
  const { alice, call } = await setup();
  capped = true;
  const res = await call(alice, "/api/connectors/slack/connect", "POST");
  assert.equal(res.status, 409);
  assert.match(JSON.stringify(await res.json()), new RegExp(NANGO_CAP_MESSAGE.slice(0, 40)));
});

test("each connector answers a read question through Nango's proxy", async () => {
  for (const key of PROVIDERS) connect("apple-carol", key);
  const owner = "apple-carol";
  const cases: [string, unknown, RegExp][] = [
    [
      "read_outlook_calendar",
      { timeMin: "2026-10-09T00:00:00Z", timeMax: "2026-10-10T00:00:00Z" },
      /Standup/,
    ],
    ["search_slack", { query: "launch", limit: 5 }, /launch is Friday/],
    ["list_teams_chats_and_channels", {}, /General/],
    ["search_jira", { jql: "assignee = currentUser()", limit: 5 }, /Fix login/],
    [
      "quickbooks_profit_and_loss",
      { startDate: "2026-01-01", endDate: "2026-09-30" },
      /Net Income 4200/,
    ],
    ["stripe_read", { kind: "balance", limit: 5 }, /12345/],
    ["gusto_read", { kind: "payrolls" }, /2026-10-01/],
  ];
  for (const [name, args, expected] of cases) {
    const result = await tool(owner, name)(args);
    assert.equal(result.error, undefined, `${name}: ${result.error}`);
    assert.match(JSON.stringify(result.data), expected, name);
  }
  assert.ok(
    proxyCalls.every((c) => c.method === "GET"),
    "reads never write",
  );
  assert.ok(proxyCalls.every((c) => c.connectionId.startsWith("conn-apple-carol-")));
});

for (const [kind, data, key, sendPath] of [
  [
    "outlook.email.send",
    { to: ["someone@example.com"], subject: "Hi", body: "Hello" },
    "outlook",
    "/v1.0/me/sendMail",
  ],
  [
    "slack.message.send",
    { channel: "C123", channelName: "general", text: "Ship it" },
    "slack",
    "/chat.postMessage",
  ],
] as const) {
  test(`${kind} produces a review card and sends nothing until approved`, async () => {
    const { alice, bob, call } = await setup();
    assert.equal(
      (await call(alice, "/api/actions", "POST", { kind, data })).status,
      409,
      "must connect first",
    );
    connect("apple-alice", key);
    const res = await call(alice, "/api/actions", "POST", { kind, data });
    assert.equal(res.status, 201);
    const proposal: ActionProposal = await res.json();
    assert.equal(proposal.status, "awaiting_review");
    assert.equal(proposal.account, "apple-alice@example.com");
    assert.equal(proxyCalls.filter((c) => c.method === "POST").length, 0, "nothing sent yet");

    const bobDecide = await call(bob, `/api/actions/${proposal.id}/decide`, "POST", {
      hash: proposal.hash,
      decision: "approve",
    });
    assert.notEqual(bobDecide.status, 200, "another account cannot approve");
    assert.equal(proxyCalls.length, 0);

    const approved = await call(alice, `/api/actions/${proposal.id}/decide`, "POST", {
      hash: proposal.hash,
      decision: "approve",
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).status, "succeeded");
    assert.deepEqual(
      proxyCalls.map((c) => [c.method, c.path, c.connectionId]),
      [["POST", sendPath, `conn-apple-alice-${key}`]],
    );
  });
}

test("QuickBooks and Gusto stay hidden until their production access is approved", async () => {
  const hidden = new ConnectorService(baseConfig, client);
  assert.deepEqual(
    (await hidden.list("apple-dave")).map((c) => c.id),
    ["outlook", "slack", "teams", "jira", "stripe"],
  );
  await assert.rejects(hidden.connect("apple-dave", "quickbooks"), /not configured/);
  await assert.rejects(hidden.connect("apple-dave", "gusto"), /not configured/);
  const approved = new ConnectorService(approvedConfig, client);
  assert.ok((await approved.list("apple-dave")).some((c) => c.id === "gusto"));
});
