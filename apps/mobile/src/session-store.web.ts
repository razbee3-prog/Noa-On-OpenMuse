import type { Session } from "./api";
import { notifySignedOut } from "./session-events";

const KEY = "noa.session";
// The web admin session survives reloads but not closing the tab.
const storage = () => (typeof sessionStorage === "undefined" ? null : sessionStorage);
export async function loadSession(): Promise<Session | null> {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  return session.expiresAt && Date.parse(session.expiresAt) <= Date.now() ? null : session;
}
export async function saveSession(session: Session) {
  storage()?.setItem(KEY, JSON.stringify(session));
}
export async function clearSession() {
  storage()?.removeItem(KEY);
}
export async function signOutLocally() {
  await clearSession();
  notifySignedOut();
}
