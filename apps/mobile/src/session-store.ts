import * as SecureStore from "expo-secure-store";
import type { Session } from "./api";
import { notifySignedOut } from "./session-events";

const KEY = "noa.session";
/** The session token lives in the iOS Keychain, readable only on this device after first unlock. */
export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  return session.expiresAt && Date.parse(session.expiresAt) <= Date.now() ? null : session;
}
export function saveSession(session: Session) {
  return SecureStore.setItemAsync(KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
export function clearSession() {
  return SecureStore.deleteItemAsync(KEY);
}
export async function signOutLocally() {
  await clearSession();
  notifySignedOut();
}
