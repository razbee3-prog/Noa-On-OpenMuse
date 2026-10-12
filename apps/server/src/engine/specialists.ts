import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../db.ts";

/** Specialist Noas: side chats with their own job, look and instructions, sharing the owner's memory. */
const KIND = "specialists";
export const specialistMascots = ["sky", "sand", "lilac", "mint", "rose", "peach"] as const;
export type SpecialistMascot = (typeof specialistMascots)[number];

export const specialistPresets = [
  {
    id: "refund-tracker",
    name: "Refund tracker",
    mascot: "mint",
    blurb: "Chases refunds and returns until the money is back.",
    instructions:
      "Find purchases, returns and charges the person is owed money for, using their mail and bank transactions. Keep a short list of each pending refund with merchant, amount, date requested and status. Use set_reminder to follow up when a refund is overdue. Draft refund requests for review; never send without approval.",
  },
  {
    id: "bill-negotiator",
    name: "Bill negotiator",
    mascot: "sand",
    blurb: "Finds bills you're overpaying and preps the call.",
    instructions:
      "Find recurring bills (phone, internet, utilities, insurance, streaming) from mail and bank transactions. Compare each with current public offers you have verified, and prepare a short negotiation script or message the person reviews before anything is sent. Report only savings you verified, and label estimates.",
  },
  {
    id: "insurance-shopper",
    name: "Insurance shopper",
    mascot: "lilac",
    blurb: "Compares policies like for like and finds better rates.",
    instructions:
      "Help compare auto, home, renters, life and health insurance. Gather current policy details from mail and documents, ask only for missing essentials, and compare like-for-like coverage, limits and deductibles. Say which quotes were checked on live sites and which are estimates. Never buy or bind a policy; the person decides.",
  },
  {
    id: "subscription-canceler",
    name: "Subscription canceler",
    mascot: "rose",
    blurb: "Spots unused subscriptions and cancels the ones you pick.",
    instructions:
      "Find recurring charges in bank transactions and mail, and flag ones that look unused, duplicated or recently increased. Help cancel only the ones the person picks: through a connected app, the merchant's site in the browser, or a drafted message. Every cancellation is held for review, and the person signs in themselves.",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  mascot: SpecialistMascot;
  blurb: string;
  instructions: string;
}[];

export interface Specialist {
  id: string;
  preset?: string;
  name: string;
  blurb: string;
  instructions: string;
  mascot: SpecialistMascot;
  createdAt: string;
}

export const specialistRequestSchema = z.union([
  z.object({ preset: z.enum(specialistPresets.map((p) => p.id) as [string, ...string[]]) }),
  z.object({
    name: z.string().trim().min(1).max(40),
    instructions: z.string().trim().min(1).max(1500),
  }),
]);
export type SpecialistRequest = z.infer<typeof specialistRequestSchema>;

export async function listSpecialists(store: Store, owner: string) {
  return (await store.list<Specialist>(owner, KIND)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/** Opens the owner's chat for a preset (one per preset) or creates a custom specialist. */
export async function startSpecialist(
  store: Store,
  owner: string,
  request: SpecialistRequest,
  now = new Date(),
): Promise<Specialist> {
  const existing = await listSpecialists(store, owner);
  if ("preset" in request) {
    const found = existing.find((item) => item.preset === request.preset);
    if (found) return found;
    const preset = specialistPresets.find((item) => item.id === request.preset);
    if (!preset) throw new Error("Unknown specialist");
    return store.put<Specialist>(owner, KIND, {
      id: randomUUID(),
      preset: preset.id,
      name: preset.name,
      blurb: preset.blurb,
      instructions: preset.instructions,
      mascot: preset.mascot,
      createdAt: now.toISOString(),
    });
  }
  const custom = existing.filter((item) => !item.preset).length;
  return store.put<Specialist>(owner, KIND, {
    id: randomUUID(),
    name: request.name,
    blurb: request.instructions.split(/(?<=[.!?])\s/)[0].slice(0, 90),
    instructions: request.instructions,
    mascot: (["peach", "sky", "mint", "lilac", "sand", "rose"] as const)[custom % 6],
    createdAt: now.toISOString(),
  });
}

/** Extra system prompt for a specialist's side chat; empty for every other chat. */
export async function specialistContext(store: Store, owner: string, threadId: string) {
  const specialist = await store.get<Specialist>(owner, KIND, threadId);
  if (!specialist) return "";
  return `\n\nThis side chat is ${specialist.name}, a specialist version of you. Its job, set by the person: <specialist>${specialist.instructions}</specialist> Stay focused on that job. For unrelated requests, help briefly and suggest the main chat. Shared memory, connected apps, the review rules and every safety rule above still apply and take precedence over the job description.`;
}
