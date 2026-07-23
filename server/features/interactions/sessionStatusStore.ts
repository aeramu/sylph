const sessionStatuses = new Map<string, Map<string, string>>();

export function getSessionStatuses(sessionId: string): Record<string, string> {
  const statuses = sessionStatuses.get(sessionId);
  return statuses ? Object.fromEntries(statuses) : {};
}

export function setSessionStatus(sessionId: string, key: string, text: string | undefined) {
  let statuses = sessionStatuses.get(sessionId);
  if (text === undefined) {
    statuses?.delete(key);
    if (statuses?.size === 0) sessionStatuses.delete(sessionId);
    return;
  }
  if (!statuses) {
    statuses = new Map();
    sessionStatuses.set(sessionId, statuses);
  }
  statuses.set(key, text);
}

export function clearSessionStatuses(sessionId: string) {
  sessionStatuses.delete(sessionId);
}
