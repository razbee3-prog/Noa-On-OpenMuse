import type { AgentTask } from "../../../../packages/domain/src/agent.ts";

/** A worker's "done" is a claim: every requirement needs to be met with concrete evidence. */
export interface CompletionCheck {
  requirement: string;
  met: boolean;
  evidence: string;
}
export function unmetChecks(checks: CompletionCheck[]) {
  return checks.filter((c) => !c.met || !c.evidence.trim()).map((c) => c.requirement);
}

export const LATE_AFTER_MS = 15 * 60000;
/** Scheduled work whose time has passed by more than the grace period. */
export function lateTasks(tasks: AgentTask[], now = Date.now()) {
  return tasks.filter(
    (t) => t.status === "scheduled" && Date.parse(t.nextRunAt ?? "") < now - LATE_AFTER_MS,
  );
}
