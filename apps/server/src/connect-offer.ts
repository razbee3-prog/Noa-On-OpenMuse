export const CONNECT_SERVICES = [
  "google",
  "plaid",
  "outlook",
  "slack",
  "teams",
  "jira",
  "stripe",
  "quickbooks",
  "gusto",
] as const;
export type ConnectService = (typeof CONNECT_SERVICES)[number];

const NAMES: Record<ConnectService, string> = {
  google: "Gmail and Calendar",
  plaid: "your bank",
  outlook: "Outlook",
  slack: "Slack",
  teams: "Microsoft Teams",
  jira: "Jira",
  stripe: "Stripe",
  quickbooks: "QuickBooks",
  gusto: "Gusto",
};

/** The chat shows this as a card whose Connect button starts the same sign-in as Apps. */
export function connectOffer(service: ConnectService, reason: string, browserAlternative = false) {
  return { kind: "connect" as const, service, name: NAMES[service], reason, browserAlternative };
}

export const connectOfferInstructions =
  " In chat, when a request needs one of offer_connect's services and it is not connected (a tool says so, or no bank is linked), call offer_connect right away instead of telling the person to go to Apps or settings. The card carries the Connect button, so add at most one short line of text. Set browserAlternative when your browser could do the job instead. After they connect, finish the original request without being asked again.";
