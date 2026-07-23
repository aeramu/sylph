import fs from "fs";
import path from "path";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import { SCRATCH_DIR } from "../../../config.ts";

/**
 * Return this session's private temporary directory, creating it when needed.
 * Session ids originate from Pi, but basename keeps this boundary safe if a
 * malformed external binding is ever imported.
 */
export function ensureSessionScratch(sessionId: string): string {
  const safeId = path.basename(sessionId);
  if (!safeId || safeId === "." || safeId === ".." || safeId !== sessionId) {
    throw new Error("Invalid session id for scratch directory");
  }
  fs.mkdirSync(SCRATCH_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(SCRATCH_DIR, 0o700); } catch { /* best effort on filesystems without Unix modes */ }
  const scratchPath = path.join(SCRATCH_DIR, safeId);
  fs.mkdirSync(scratchPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(scratchPath, 0o700); } catch { /* best effort on filesystems without Unix modes */ }
  return scratchPath;
}

/** Create a Pi session whose immutable header cwd is its own scratch path. */
export function createScratchSessionManager(): SessionManager {
  const reserved = SessionManager.inMemory(process.cwd());
  const sessionId = reserved.getSessionId();
  const scratchPath = ensureSessionScratch(sessionId);
  return SessionManager.create(scratchPath, undefined, { id: sessionId });
}

export function removeSessionScratch(sessionId: string): void {
  const safeId = path.basename(sessionId);
  if (!safeId || safeId === "." || safeId === ".." || safeId !== sessionId) return;
  fs.rmSync(path.join(SCRATCH_DIR, safeId), { recursive: true, force: true });
}
