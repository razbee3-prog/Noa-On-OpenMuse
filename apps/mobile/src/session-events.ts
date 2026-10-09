const listeners = new Set<() => void>();
export function onSignedOut(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifySignedOut() {
  for (const listener of listeners) listener();
}
