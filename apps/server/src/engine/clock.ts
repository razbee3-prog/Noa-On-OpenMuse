const ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

/** Anchors the model to the real date so "recent" never means a year it remembers from training. */
export function clockContext(now = new Date(), timeZone?: string) {
  const zone = timeZone && ZONE.test(timeZone) && validZone(timeZone) ? timeZone : "UTC";
  const local = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  });
  return ` Right now it is ${local} (${now.toISOString()}). Treat this as today: "recent", "latest", "this year" and "last month" are relative to it. When finding receipts, emails, transactions or documents without a date, start with the most recent ones (for mail, add newer_than:90d to the query unless the person names a period) and say which dates you covered. Never assume an earlier year.`;
}

function validZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
