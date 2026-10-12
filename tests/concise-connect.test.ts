import assert from "node:assert/strict";
import test from "node:test";
import { splitReply } from "../apps/mobile/src/assistant-markdown.ts";
import { browserConsole } from "../apps/server/src/browser-console.ts";
import { CONNECT_SERVICES, connectOffer } from "../apps/server/src/connect-offer.ts";

test("a reply with --- lines shows as separate messages", () => {
  assert.deepEqual(splitReply("Found 3 new charges.\n\n---\n\nWant me to flag the $40 one?"), [
    "Found 3 new charges.",
    "Want me to flag the $40 one?",
  ]);
  assert.deepEqual(splitReply("Just one message."), ["Just one message."]);
  assert.deepEqual(splitReply("Trailing\n---"), ["Trailing"]);
  assert.deepEqual(splitReply(""), []);
});

test("connect offers name the service and default to no browser alternative", () => {
  assert.deepEqual(connectOffer("google", "To read your email"), {
    kind: "connect",
    service: "google",
    name: "Gmail and Calendar",
    reason: "To read your email",
    browserAlternative: false,
  });
  for (const service of CONNECT_SERVICES) assert.ok(connectOffer(service, "why").name);
  assert.equal(connectOffer("slack", "why", true).browserAlternative, true);
});

test("browser console types through the native keyboard with no separate text box", () => {
  const html = browserConsole("/api/browsers/b1/preview?sig=x");
  assert.match(html, /id="sink"/);
  assert.match(html, /aria-label="Keyboard"/);
  assert.match(html, /naturalWidth/);
  assert.doesNotMatch(html, /Send text|Type into the selected field|OpenMuse/);
});
