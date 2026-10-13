import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { withRetries } from "./retry.ts";

type Intel = CopilotKitIntelligence;

/**
 * Retries thread reads and idempotent thread calls up to three times when the
 * Intelligence platform has a brief outage, so a passing 502 never reaches the app.
 * Writes that could duplicate (create, memories, locks) are left alone.
 */
export class RetryingIntelligence extends CopilotKitIntelligence {
  static delays: readonly number[] = [400, 1200, 3000];
  #retry<T>(call: () => Promise<T>) {
    return withRetries(call, RetryingIntelligence.delays);
  }
  override listThreads(params: Parameters<Intel["listThreads"]>[0]) {
    return this.#retry(() => super.listThreads(params));
  }
  override getThread(params: Parameters<Intel["getThread"]>[0]) {
    return this.#retry(() => super.getThread(params));
  }
  override getOrCreateThread(params: Parameters<Intel["getOrCreateThread"]>[0]) {
    return this.#retry(() => super.getOrCreateThread(params));
  }
  override getThreadMessages(params: Parameters<Intel["getThreadMessages"]>[0]) {
    return this.#retry(() => super.getThreadMessages(params));
  }
  override getThreadEvents(params: Parameters<Intel["getThreadEvents"]>[0]) {
    return this.#retry(() => super.getThreadEvents(params));
  }
  override getThreadState(params: Parameters<Intel["getThreadState"]>[0]) {
    return this.#retry(() => super.getThreadState(params));
  }
  override archiveThread(params: Parameters<Intel["archiveThread"]>[0]) {
    return this.#retry(() => super.archiveThread(params));
  }
  override listMemories(params: Parameters<Intel["listMemories"]>[0]) {
    return this.#retry(() => super.listMemories(params));
  }
  override recallMemories(params: Parameters<Intel["recallMemories"]>[0]) {
    return this.#retry(() => super.recallMemories(params));
  }
  override ɵsubscribeToThreads(params: Parameters<Intel["ɵsubscribeToThreads"]>[0]) {
    return this.#retry(() => super.ɵsubscribeToThreads(params));
  }
  override ɵsubscribeToMemories(params: Parameters<Intel["ɵsubscribeToMemories"]>[0]) {
    return this.#retry(() => super.ɵsubscribeToMemories(params));
  }
  override ɵconnectThread(params: Parameters<Intel["ɵconnectThread"]>[0]) {
    return this.#retry(() => super.ɵconnectThread(params));
  }
}
