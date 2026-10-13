import type { TrackedItem } from "../../../../packages/domain/src/agent.ts";
import type { Store } from "../db.ts";
import { looksSensitive } from "./soul-memory.ts";

/** Open loops the person is waiting on (deliveries, reservations, refunds, bills), each with a timeline. */
const KIND = "tracked";
const KEEP_DONE_MS = 30 * 86400000;
const clean = (text: string, limit: number) => text.replace(/\s+/g, " ").trim().slice(0, limit);
const slug = (kind: string, title: string) =>
  `${kind}:${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)}`;

export interface TrackInput {
  kind: TrackedItem["kind"];
  title: string;
  update: string;
  dueAt?: string;
  status?: TrackedItem["status"];
}

/** Creates the item, or adds an update to the one with the same kind and title. */
export async function trackItem(
  store: Store,
  owner: string,
  input: TrackInput,
  now = new Date().toISOString(),
) {
  const title = clean(input.title, 120);
  const text = clean(input.update, 200);
  if (!title || looksSensitive(`${title} ${text}`))
    return { error: "Leave out card, account and order numbers and try again." };
  const id = slug(input.kind, title);
  const existing = await store.get<TrackedItem>(owner, KIND, id);
  const dueAt = input.dueAt ?? existing?.dueAt;
  const item: TrackedItem = {
    id,
    kind: input.kind,
    title: existing?.title ?? title,
    status: input.status ?? existing?.status ?? "open",
    ...(dueAt ? { dueAt } : {}),
    timeline: [...(existing?.timeline ?? []), { at: now, text: text || "Tracking" }].slice(-20),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.dueNotifiedAt && dueAt === existing.dueAt
      ? { dueNotifiedAt: existing.dueNotifiedAt }
      : {}),
  };
  await store.put<TrackedItem>(owner, KIND, item);
  return item;
}

export async function closeTracked(
  store: Store,
  owner: string,
  id: string,
  now = new Date().toISOString(),
) {
  const item = await store.get<TrackedItem>(owner, KIND, id);
  if (!item) throw new Error("Tracked item not found");
  if (item.status === "done") return item;
  const done: TrackedItem = {
    ...item,
    status: "done",
    timeline: [...item.timeline, { at: now, text: "Marked done" }].slice(-20),
    updatedAt: now,
  };
  await store.put<TrackedItem>(owner, KIND, done);
  return done;
}

export const listTracked = (store: Store, owner: string) => store.list<TrackedItem>(owner, KIND);

const DUE_TEXT: Record<TrackedItem["kind"], string> = {
  delivery: "This should have arrived by now. Did it come?",
  reservation: "This is coming up now.",
  refund: "This refund was due by now. Want me to check on it?",
  bill: "This bill is due.",
  other: "This is due now.",
};

/** Open items whose due time has passed, each returned once; finished items are dropped after 30 days. */
export async function claimDueTracked(store: Store, now = Date.now()) {
  const due: { owner: string; item: TrackedItem; text: string }[] = [];
  for (const { owner, value } of await store.scan<TrackedItem>(KIND)) {
    if (value.status === "done") {
      if (now - Date.parse(value.updatedAt) > KEEP_DONE_MS)
        await store.remove(owner, KIND, value.id);
      continue;
    }
    if (!value.dueAt || value.dueNotifiedAt || Date.parse(value.dueAt) > now) continue;
    await store.put<TrackedItem>(owner, KIND, {
      ...value,
      dueNotifiedAt: new Date(now).toISOString(),
    });
    due.push({ owner, item: value, text: DUE_TEXT[value.kind] });
  }
  return due;
}
