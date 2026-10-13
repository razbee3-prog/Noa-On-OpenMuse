import type { AgentTask } from "../../../packages/domain/src/agent";

/** A failed attempt being retried quietly still reads as work in progress. */
export function isRetrying(task: AgentTask) {
  return task.status === "scheduled" && Number(task.state?.quietRetries ?? 0) > 0;
}

/** What the header pill says Noa is doing: which routine, and whether it needs the person. */
export function routineStatus(tasks: readonly AgentTask[]) {
  const needsYou = tasks.find(
    (task) => task.status === "waiting_approval" || task.status === "waiting_input",
  );
  if (needsYou)
    return needsYou.status === "waiting_approval"
      ? `Ready to review · ${needsYou.title}`
      : `Needs your input · ${needsYou.title}`;
  const running = tasks.find((task) => task.status === "running" || isRetrying(task));
  if (running) return `Working on · ${running.title}`;
  const queued = tasks.find((task) => task.status === "queued");
  return queued ? `Starting · ${queued.title}` : "";
}

function when(value: number, now: number) {
  const date = new Date(value);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = (offset: number) => new Date(now + offset * 86400000).toDateString();
  if (date.toDateString() === day(0)) return `today ${time}`;
  if (date.toDateString() === day(1)) return `tomorrow ${time}`;
  const weekday =
    value - now < 6 * 86400000
      ? date.toLocaleDateString("en-US", { weekday: "short" })
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${weekday} ${time}`;
}

/** When a scheduled routine runs next, and how often it repeats, e.g. "Next: Fri 9:00 AM · every week". */
export function nextRunLabel(task: AgentTask, now = Date.now()) {
  if (task.status !== "scheduled" || isRetrying(task) || !task.nextRunAt) return "";
  const at = Date.parse(task.nextRunAt);
  if (!Number.isFinite(at)) return "";
  const repeat = task.kind === "reminder" ? task.input.repeat : undefined;
  const minutes = task.kind === "monitor" ? Number(task.input.intervalMinutes) : 0;
  const every =
    repeat === "daily"
      ? " · every day"
      : repeat === "weekly"
        ? " · every week"
        : minutes >= 60 && minutes % 60 === 0
          ? ` · every ${minutes === 60 ? "hour" : `${minutes / 60} hours`}`
          : minutes > 0
            ? ` · every ${minutes} min`
            : "";
  return `Next: ${when(at, now)}${every}`;
}
