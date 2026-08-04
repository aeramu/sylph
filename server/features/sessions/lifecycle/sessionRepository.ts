import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import type { SessionBinding } from "../workspace/workspaceTypes.ts";

export function openStoredSession(sessionId: string, binding?: SessionBinding): SessionManager | undefined {
  if (binding?.sessionFile && fs.existsSync(binding.sessionFile)) {
    const manager = SessionManager.open(binding.sessionFile);
    if (manager.getSessionId() === sessionId) return manager;
  }
  return undefined;
}

export async function findStoredSession(sessionId: string, binding?: SessionBinding): Promise<SessionManager | undefined> {
  const bound = openStoredSession(sessionId, binding);
  if (bound) return bound;
  try {
    const session = (await SessionManager.listAll()).find((entry) => entry.id === sessionId);
    if (session?.path && fs.existsSync(session.path)) return SessionManager.open(session.path);
  } catch { /* unavailable global session index */ }
  return undefined;
}

export async function collectSessionSummaries(bindings: SessionBinding[], directories: Iterable<string>, includeGlobal: boolean) {
  const byId = new Map<string, any>();
  if (includeGlobal) {
    // listAll already includes every default per-cwd session directory. Do not
    // immediately reread those same JSONL files via list(directory): with a
    // large history that doubled startup I/O and rebuilt all search text twice.
    try { for (const session of await SessionManager.listAll()) byId.set(session.id, session); } catch { /* directory fallbacks below */ }
  } else {
    for (const directory of directories) {
      if (!fs.existsSync(directory)) continue;
      try { for (const session of await SessionManager.list(directory)) byId.set(session.id, session); } catch { /* unavailable roots do not hide others */ }
    }
  }
  for (const binding of bindings) {
    if (byId.has(binding.sessionId) || !binding.sessionFile || !fs.existsSync(binding.sessionFile)) continue;
    try {
      const detached = SessionManager.open(binding.sessionFile);
      const info = (await SessionManager.list(binding.cwd, path.dirname(binding.sessionFile))).find((entry) => entry.id === binding.sessionId);
      if (info) byId.set(info.id, info);
      else if (detached.getSessionId() === binding.sessionId) {
        const header = detached.getHeader();
        byId.set(binding.sessionId, {
          id: binding.sessionId, path: binding.sessionFile, cwd: binding.cwd,
          created: new Date(header?.timestamp || 0), modified: fs.statSync(binding.sessionFile).mtime,
          messageCount: detached.buildSessionContext().messages.length, firstMessage: "Worktree session", allMessagesText: "",
        });
      }
    } catch { /* malformed session binding */ }
  }
  return byId;
}
