const TRANSIENT_MESSAGE =
  /timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|overloaded|rate.?limit|too many requests|temporarily|service unavailable|bad gateway|\b(408|429|50[0-4]|529)\b/i;

/** A brief outage worth retrying: a dropped connection, a 5xx, a timeout or a rate limit. */
export function isTransient(error: unknown) {
  if (error instanceof TypeError) return true;
  const status = (error as { status?: unknown } | undefined)?.status;
  if (typeof status === "number") return status >= 500 || status === 429 || status === 408;
  return error instanceof Error && TRANSIENT_MESSAGE.test(error.message);
}

/** Runs `call`, retrying transient failures once per delay before giving up. */
export async function withRetries<T>(call: () => Promise<T>, delays: readonly number[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= delays.length || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}
