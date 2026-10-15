import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { tanstackAgent } from "../apps/server/src/engine/tanstack-agent.ts";
import { langfuseMiddleware, shutdownLangfuse } from "../apps/server/src/langfuse.ts";
import { modelFixture } from "./helpers/model.ts";

type Attr = {
  key: string;
  value: { stringValue?: string; arrayValue?: { values: { stringValue?: string }[] } };
};
type OtlpSpan = { name: string; spanId: string; parentSpanId?: string; attributes: Attr[] };

const attr = (span: OtlpSpan, key: string) => {
  const value = span.attributes.find((a) => a.key === key)?.value;
  return value?.stringValue ?? value?.arrayValue?.values.map((v) => v.stringValue);
};

test("no Langfuse keys means no tracing middleware", () => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  assert.deepEqual(langfuseMiddleware({ name: "chat-reply" }), []);
});

test("an agent run is sent to Langfuse as one trace with generations and tool calls", async (t) => {
  const bodies: { path?: string; auth?: string; body: string }[] = [];
  const langfuse = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = (req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString();
      bodies.push({ path: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => langfuse.listen(0, "127.0.0.1", resolve));
  t.after(() => langfuse.close());
  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${(langfuse.address() as AddressInfo).port}`;
  t.after(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  await modelFixture(t, (index) =>
    index === 0 ? { name: "note_step", arguments: { note: "step one" } } : undefined,
  );
  const agent = tanstackAgent({
    model: "openai/fixture",
    maxSteps: 3,
    trace: { name: "chat-reply", userId: "owner-1" },
    tools: [
      defineTool({
        name: "note_step",
        description: "Record a step note",
        parameters: z.object({ note: z.string() }),
        execute: async ({ note }) => ({ recorded: note }),
      }),
    ],
    prompt: "Use the tool once, then finish.",
  });
  const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    messages: [{ id: "m1", role: "user", content: "Note one step." }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
  await new Promise<void>((resolve, reject) =>
    agent.run(input).subscribe({
      next: (event) => {
        if (event.type === EventType.RUN_ERROR) reject(new Error(JSON.stringify(event)));
      },
      error: reject,
      complete: resolve,
    }),
  );
  await shutdownLangfuse();

  assert.ok(bodies.length > 0, "spans were exported");
  for (const sent of bodies) {
    assert.equal(sent.path, "/api/public/otel/v1/traces");
    assert.equal(sent.auth, `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
  }
  const spans: OtlpSpan[] = bodies.flatMap((sent) =>
    JSON.parse(sent.body).resourceSpans.flatMap((r: { scopeSpans: { spans: OtlpSpan[] }[] }) =>
      r.scopeSpans.flatMap((s) => s.spans),
    ),
  );
  const root = spans.find((span) => !span.parentSpanId);
  assert.ok(root, "one root span");
  assert.equal(root.name, "chat-reply");
  assert.equal(attr(root, "langfuse.observation.type"), "agent");
  const generations = spans.filter(
    (span) => attr(span, "langfuse.observation.type") === "generation",
  );
  const tools = spans.filter((span) => attr(span, "langfuse.observation.type") === "tool");
  assert.ok(generations.length >= 2, "a generation per model call");
  assert.deepEqual(
    tools.map((span) => span.name),
    ["note_step"],
  );
  for (const span of spans) {
    assert.equal(attr(span, "langfuse.trace.name"), "chat-reply");
    assert.equal(attr(span, "langfuse.user.id"), "owner-1");
    assert.equal(attr(span, "langfuse.session.id"), "thread-1");
  }
  assert.ok(String(attr(root, "langfuse.trace.input")).includes("Note one step."));
});
