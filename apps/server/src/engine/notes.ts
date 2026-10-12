import type { Store } from "../db.ts";
import { AppError } from "../errors.ts";
import { loadMemory, looksSensitive } from "./soul-memory.ts";

/** Dated daily notes and per-person pages: the raw trail that stays out of MEMORY.md. */
export interface DailyNote {
  id: string;
  lines: string[];
  updatedAt: string;
}
export interface PersonPage {
  id: string;
  name: string;
  facts: string[];
  updatedAt: string;
}
export interface MemoryHit {
  source: string;
  text: string;
}

const NOTES = "daily-notes";
const PEOPLE = "people";
const LINE_LIMIT = 300;
const NOTE_LINES = 200;
const PERSON_FACTS = 50;
const KEEP_DAYS = 180;

const now = () => new Date().toISOString();
const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, LINE_LIMIT);
export const personId = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

async function update<T extends { id: string; updatedAt: string }>(
  store: Store,
  owner: string,
  kind: string,
  initial: T,
  change: (value: T) => T,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.insertIfAbsent(owner, kind, initial);
    const current = await store.get<T>(owner, kind, initial.id);
    if (!current) continue;
    const next = { ...change(current), updatedAt: now() };
    if (await store.compareAndSwap(owner, kind, initial.id, { updatedAt: current.updatedAt }, next))
      return next;
  }
  throw new AppError("Memory is busy. Try again.", 409);
}

/** Appends one line to today's note. Sensitive or empty lines are dropped silently. */
export async function appendDailyNote(store: Store, owner: string, line: string, day = now()) {
  const text = clean(line);
  if (!text || looksSensitive(text)) return;
  const id = day.slice(0, 10);
  const stamp = day.slice(11, 16);
  await update<DailyNote>(store, owner, NOTES, { id, lines: [], updatedAt: "" }, (note) => ({
    ...note,
    lines: [...note.lines, `${stamp} ${text}`].slice(-NOTE_LINES),
  }));
}

export async function rememberPerson(store: Store, owner: string, name: string, fact: string) {
  const id = personId(name);
  const text = clean(fact);
  if (!id || !text) throw new AppError("Give a name and a fact.", 400);
  if (looksSensitive(`${name} ${text}`))
    throw new AppError("Memory can't hold passwords, codes or card numbers.", 400);
  const dated = `${text} (${now().slice(0, 10)})`;
  return update<PersonPage>(
    store,
    owner,
    PEOPLE,
    { id, name: clean(name), facts: [], updatedAt: "" },
    (page) => ({
      ...page,
      facts: [
        ...page.facts.filter((f) => f.replace(/ \(\d{4}-\d{2}-\d{2}\)$/, "") !== text),
        dated,
      ].slice(-PERSON_FACTS),
    }),
  );
}

export async function peopleNames(store: Store, owner: string) {
  return (await store.list<PersonPage>(owner, PEOPLE)).map((p) => p.name).sort();
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9$]+/)
      .filter((w) => w.length > 2),
  );

/** Keyword search across MEMORY.md, people pages and daily notes, newest notes first on ties. */
export async function searchMemory(store: Store, owner: string, query: string, limit = 12) {
  const terms = words(query);
  if (!terms.size) return [];
  const [memory, people, notes] = await Promise.all([
    loadMemory(store, owner),
    store.list<PersonPage>(owner, PEOPLE),
    store.list<DailyNote>(owner, NOTES),
  ]);
  const candidates: MemoryHit[] = [
    ...memory.text
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => ({ source: "MEMORY.md", text: l.slice(2) })),
    ...people.flatMap((p) =>
      p.facts.map((f) => ({ source: `person: ${p.name}`, text: `${p.name}: ${f}` })),
    ),
    ...notes
      .sort((a, b) => b.id.localeCompare(a.id))
      .flatMap((n) => n.lines.map((l) => ({ source: `note ${n.id}`, text: l }))),
  ];
  return candidates
    .map((hit, order) => {
      const have = words(hit.text);
      let score = 0;
      for (const term of terms) if (have.has(term)) score++;
      return { hit, score, order };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.hit);
}

export async function pruneOldNotes(store: Store, today = now()) {
  const cutoff = new Date(Date.parse(today) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const { owner, value } of await store.scan<DailyNote>(NOTES))
    if (value.id < cutoff) await store.remove(owner, NOTES, value.id);
}
