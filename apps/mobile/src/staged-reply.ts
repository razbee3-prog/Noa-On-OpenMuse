/** Noa's bubbles land one at a time, like texts, with a short typing pause between them. */
export const FIRST_BUBBLE_DELAY = 450;
export const NEXT_BUBBLE_DELAY = 1000;

export type StagedMessage = { id: string; available: number; shown: number };

/** While a reply is still streaming, its last bubble may be cut mid-sentence. */
export function availableBubbles(count: number, streaming: boolean) {
  return streaming ? Math.max(0, count - 1) : count;
}

/** The next bubble to reveal, oldest first, and how long to type before it. */
export function nextReveal(items: StagedMessage[]) {
  const index = items.findIndex((item) => item.shown < item.available);
  if (index < 0) return undefined;
  const item = items[index];
  const revealedBefore = item.shown > 0 || items.slice(0, index).some((prior) => prior.shown > 0);
  return { id: item.id, delay: revealedBefore ? NEXT_BUBBLE_DELAY : FIRST_BUBBLE_DELAY };
}
