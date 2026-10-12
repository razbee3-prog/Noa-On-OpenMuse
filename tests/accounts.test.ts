import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { appleOwnerId, appleVerifier } from "../apps/server/src/accounts.ts";
import { createApp } from "../apps/server/src/app.ts";
import { SESSION_TTL_MS } from "../apps/server/src/auth.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";
import { createSamplePdf } from "../packages/integrations/src/pdf.ts";
import { config as computerConfig, fixture, ok } from "./helpers/computer.ts";

const AUDIENCE = "com.razbhimani.noa";
let db: Store, directory: string, worker: ReturnType<typeof createServer>, workerUrl: string;
let signKey: CryptoKey, verify: ReturnType<typeof appleVerifier>;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "noa-accounts-"));
  db = await createStore();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  signKey = privateKey;
  verify = appleVerifier(
    [AUDIENCE],
    createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" }] }),
  );
  worker = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: body.id,
        url: body.url ?? "https://example.com/",
        title: "Example",
        status: "active",
        updatedAt: new Date().toISOString(),
      }),
    );
  });
  worker.listen(0, "127.0.0.1");
  await once(worker, "listening");
  const address = worker.address();
  assert(address && typeof address !== "string");
  workerUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  worker.close();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

const appleToken = (sub: string, audience = AUDIENCE) =>
  new SignJWT({ email: `${sub}@privaterelay.appleid.com` })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(audience)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signKey);

async function server(owner?: string) {
  const docker = fixture({ command: async () => ok("ran"), owner });
  const created = await createApp(
    db,
    {
      ...computerConfig,
      dataDir: directory,
      workerUrl,
      workerToken: "w".repeat(32),
      accessKey: "admin-access-key-for-tests-only",
      trustProxy: true,
    },
    { docker: docker.runner, appleVerifier: verify },
  );
  return created;
}
type App = Awaited<ReturnType<typeof server>>["app"];
const json = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});
async function adminToken(app: App) {
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.0.0.1" },
    body: JSON.stringify({}),
  });
  return (await response.json()).token as string;
}
function appleSignIn(app: App, body: Record<string, unknown>, ip = "10.0.0.2") {
  return app.request("/api/session/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}
async function member(app: App, sub: string, name: string) {
  const response = await appleSignIn(app, {
    identityToken: await appleToken(sub),
    fullName: name,
  });
  assert.equal(response.status, 200);
  return (await response.json()).token as string;
}

test("Apple sign-in needs a verified token, creates the account with no code, and lasts 30 days", async () => {
  const { app } = await server();
  const health = await (await app.request("/api/health")).json();
  assert.equal(health.inviteRequired, undefined);
  const wrongAudience = await appleSignIn(app, {
    identityToken: await appleToken("apple-new", "com.example.other"),
  });
  assert.equal(wrongAudience.status, 401);
  const first = await appleSignIn(app, {
    identityToken: await appleToken("apple-new"),
    inviteCode: "NOA-OLDBU-ILD66",
  });
  assert.equal(first.status, 200, "older app builds that still send a code keep working");
  const session = await first.json();
  assert.equal(session.role, "member");
  const ttl = Date.parse(session.expiresAt) - Date.now();
  assert.ok(Math.abs(ttl - SESSION_TTL_MS) < 60_000);
  const returning = await appleSignIn(app, { identityToken: await appleToken("apple-new") });
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).role, "member");
  const invites = await app.request("/api/invites", {
    method: "POST",
    headers: json(await adminToken(app)),
  });
  assert.equal(invites.status, 404, "invite codes no longer exist");
  const signOut = await app.request("/api/session", {
    method: "DELETE",
    headers: json(session.token),
  });
  assert.equal(signOut.status, 200);
  assert.equal((await app.request("/api/account", { headers: json(session.token) })).status, 401);
});

test("the sign-in throttle is per client IP", async () => {
  const { app } = await server();
  const statuses = [];
  for (let i = 0; i < 11; i++)
    statuses.push((await appleSignIn(app, { identityToken: "x".repeat(40) }, "10.9.9.9")).status);
  assert.equal(statuses.at(-1), 429);
  const other = await appleSignIn(app, { identityToken: "x".repeat(40) }, "10.9.9.10");
  assert.equal(other.status, 401, "another IP is not locked out");
});

test("two accounts cannot see each other's tasks, files, memories, browsers or computer", async () => {
  const { app } = await server();
  const alice = await member(app, "apple-alice", "Alice");
  const bob = await member(app, "apple-bob", "Bob");
  const aliceOwner = appleOwnerId("apple-alice");

  const account = await (await app.request("/api/account", { headers: json(alice) })).json();
  assert.equal(account.displayName, "Alice");
  const bobAccount = await (await app.request("/api/account", { headers: json(bob) })).json();
  assert.equal(bobAccount.displayName, "Bob");

  // Tasks
  const now = new Date().toISOString();
  await db.put<AgentTask>(aliceOwner, "tasks", {
    id: "alice-task",
    title: "Alice's private task",
    prompt: "secret",
    kind: "agent",
    status: "succeeded",
    plan: [],
    evidence: [],
    input: {},
    state: {},
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    leaseId: null,
    leaseUntil: null,
    artifactIds: [],
  });
  assert.equal(
    (await app.request("/api/agent/tasks/alice-task", { headers: json(alice) })).status,
    200,
  );
  assert.equal(
    (await app.request("/api/agent/tasks/alice-task", { headers: json(bob) })).status,
    404,
  );

  // Memories
  const memory = await app.request("/api/agent/memories", {
    method: "POST",
    headers: json(alice),
    body: JSON.stringify({ text: "Alice's allergy is penicillin" }),
  });
  assert.equal(memory.status, 201);
  const aliceAgent = await (await app.request("/api/agent", { headers: json(alice) })).json();
  const bobAgent = await (await app.request("/api/agent", { headers: json(bob) })).json();
  assert.ok(aliceAgent.memories.some((m: { text: string }) => m.text.includes("penicillin")));
  assert.ok(aliceAgent.tasks.some((t: { id: string }) => t.id === "alice-task"));
  assert.ok(!bobAgent.memories.some((m: { text: string }) => m.text.includes("penicillin")));
  assert.ok(!bobAgent.tasks.some((t: { id: string }) => t.id === "alice-task"));

  // Files
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(await createSamplePdf())], "alice.pdf", { type: "application/pdf" }),
  );
  const upload = await app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${alice}` },
    body: form,
  });
  assert.equal(upload.status, 201);
  const file = await upload.json();
  const content = (token: string) =>
    app.request(`/api/files/${file.id}/content`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await content(alice)).status, 200);
  assert.equal((await content(bob)).status, 404);
  const bobWorkspace = await (await app.request("/api/workspace", { headers: json(bob) })).json();
  assert.ok(!bobWorkspace.files.some((f: { id: string }) => f.id === file.id));

  // Browser sessions
  const opened = await app.request("/api/browsers", {
    method: "POST",
    headers: json(alice),
    body: JSON.stringify({ url: "https://example.com/" }),
  });
  assert.equal(opened.status, 201);
  const browser = await opened.json();
  assert.equal(
    (await app.request(`/api/browsers/${browser.id}`, { headers: json(alice) })).status,
    200,
  );
  assert.equal(
    (await app.request(`/api/browsers/${browser.id}`, { headers: json(bob) })).status,
    404,
  );
  assert.equal(
    (await app.request(`/api/browsers/${browser.id}/read`, { headers: json(bob) })).status,
    404,
  );
  assert.ok(!bobWorkspace.browsers.some((b: { id: string }) => b.id === browser.id));

  // Computer workspace: a container labelled for Alice never attaches to Bob.
  const { app: aliceComputer } = await server(aliceOwner);
  const run = (token: string) =>
    aliceComputer.request("/api/computer/commands", {
      method: "POST",
      headers: json(token),
      body: JSON.stringify({ command: "cat /workspace/notes.txt" }),
    });
  const aliceRun = await run(alice);
  assert.equal(aliceRun.status, 200);
  const bobRun = await run(bob);
  assert.equal(bobRun.status, 409);
  assert.match((await bobRun.json()).error, /ownership/);
});

test("browser sessions are limited per account", async () => {
  const { app } = await server();
  const carol = await member(app, "apple-carol", "Carol");
  const dave = await member(app, "apple-dave", "Dave");
  const open = (token: string) =>
    app.request("/api/browsers", {
      method: "POST",
      headers: json(token),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
  assert.equal((await open(carol)).status, 201);
  assert.equal((await open(carol)).status, 201);
  assert.equal((await open(carol)).status, 409, "a third active session is refused");
  assert.equal((await open(dave)).status, 201, "another account still gets a session");
});

test("each account sees only its own agent computer", async () => {
  const { app } = await server();
  const alice = await member(app, "apple-alice-pc", "Alice");
  const bob = await member(app, "apple-bob-pc", "Bob");
  const mine = await (await app.request("/api/agent-browser", { headers: json(alice) })).json();
  const again = await (await app.request("/api/agent-browser", { headers: json(alice) })).json();
  const theirs = await (await app.request("/api/agent-browser", { headers: json(bob) })).json();
  assert.equal(mine.id, again.id);
  assert.notEqual(mine.id, theirs.id);
  const peek = await app.request(`/api/browsers/${mine.id}`, { headers: json(bob) });
  assert.equal(peek.status, 404);
});

test("the agent computer shows when Noa needs you, only to that account", async () => {
  const { app } = await server();
  const alice = await member(app, "apple-alice-help", "Alice");
  const bob = await member(app, "apple-bob-help", "Bob");
  const read = async (headers: Record<string, string>) =>
    (await (await app.request("/api/agent-browser", { headers })).json()).needsYou;
  assert.equal(await read(json(alice)), null);
  await db.put(appleOwnerId("apple-alice-help"), "agent-help", {
    id: "owner-profile",
    site: "LinkedIn",
    reason: "Sign in to read your messages",
    askedAt: new Date().toISOString(),
    resolved: false,
  });
  assert.equal((await read(json(alice))).site, "LinkedIn");
  assert.equal(await read(json(bob)), null);
});
