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

test("a long reply without --- still splits into a few whole-paragraph texts", () => {
  const a =
    "Your October card spend is $2,140, about $300 over your usual month. Most of the jump is travel: the LA flights and the rental car.";
  const b =
    "Three charges look worth a second look:\n\n- $89 Equinox, which you said you cancelled\n- $40 Hulu, billed twice\n- $12 Apple, new this month";
  const c = "Want me to draft a dispute for the Hulu double charge?";
  assert.deepEqual(splitReply(`${a}\n\n${b}\n\n${c}`), [a, b, c]);
  assert.deepEqual(splitReply("Short.\n\nStill short."), ["Short.\n\nStill short."]);
  const table = `${a}\n\n| Month | Spend |\n| --- | --- |\n| Oct | $2,140 |\n\n${c} ${a}`;
  assert.equal(splitReply(table).length, 1);
  const many = Array.from({ length: 6 }, (_, i) => `Point ${i}: ${"word ".repeat(30).trim()}`).join(
    "\n\n",
  );
  const parts = splitReply(many);
  assert.equal(parts.length, 3);
  assert.equal(parts.join("\n\n"), many);
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
