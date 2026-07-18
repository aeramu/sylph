import fs from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RUNTIME_IDLE_MS, EVICTION_INTERVAL_MS, WORKTREES_DIR } from "../config.ts";
import { getProjects } from "../projects.ts";
import { deleteSessionBinding, getSessionBinding } from "../sessionBindings.ts";
import { buildRuntime } from "./runtimeFactory.ts";
export { getContextInfo } from "./contextUsage.ts";
import { RuntimeRegistry } from "./runtimeRegistry.ts";
import { buildSessionRuntime, type NewSessionOptions } from "./sessionResolver.ts";
export type { NewSessionOptions } from "./sessionResolver.ts";
import { clearSessionStatuses, rejectPendingForSession } from "../uiBridge.ts";
import { getRawManagedDirectories, sourceProjectForSession } from "../sessionWorkspace.ts";
import { discardProjectWorktrees } from "../projectWorktrees.ts";
import { removeSessionScratch } from "../sessionScratch.ts";

const runtimeRegistry = new RuntimeRegistry<any>();
const sessionEventSequences = new Map<string, number>();
const runtimeEvents = { nextSequence: (sessionId: string) => { const next = getSessionEventSequence(sessionId) + 1; sessionEventSequences.set(sessionId, next); return next; } };

export function touchRuntime(sessionId: string) {
  runtimeRegistry.touch(sessionId);
}

export function getActiveRuntime(sessionId: string) {
  return runtimeRegistry.get(sessionId);
}

export function getSettledRuntime(sessionId: string): Promise<any> {
  return runtimeRegistry.settled(sessionId);
}

export function disposeRuntime(sessionId: string, reason = "session runtime disposed") {
  if (!runtimeRegistry.dispose(sessionId)) return;
  sessionEventSequences.delete(sessionId);
  rejectPendingForSession(sessionId, reason);
  clearSessionStatuses(sessionId);
}

export async function rollbackNewWorktreeSession(sessionId: string) {
  const binding = getSessionBinding(sessionId);
  if (!binding) return;
  const managedDirectories = getRawManagedDirectories(binding);
  if (managedDirectories.length === 0) return;
  disposeRuntime(sessionId);
  const project = sourceProjectForSession(getProjects().find((entry) => entry.id === binding.projectId), binding);
  // discardProjectWorktrees aggregates failures and throws. Do not delete the
  // binding/session file unless it fully succeeds: they are the recovery
  // metadata for any checkout that remains.
  await discardProjectWorktrees(project, managedDirectories, WORKTREES_DIR);
  if (binding.sessionFile) fs.rmSync(binding.sessionFile, { force: true });
  removeSessionScratch(sessionId);
  deleteSessionBinding(sessionId);
}

export function getSessionEventSequence(sessionId: string) {
  return sessionEventSequences.get(sessionId) ?? 0;
}

// Build a runtime and wire up its SSE broadcast. Does not touch activeRuntimes;
// registration (and dedup) is the caller's responsibility.
export function getOrInitRuntime(sessionId?: string, projectId?: string, options: NewSessionOptions = {}): Promise<any> {
  if (sessionId) {
    return runtimeRegistry.getOrBuild(sessionId, () => buildSessionRuntime(sessionId, projectId, options, rollbackNewWorktreeSession, runtimeEvents).then(({ runtime }) => runtime));
  }
  return buildSessionRuntime(undefined, projectId, options, rollbackNewWorktreeSession, runtimeEvents).then(({ runtime, resolvedSessionId }) => {
    runtimeRegistry.register(resolvedSessionId, runtime);
    return runtime;
  });
}

// A single cached runtime used only to introspect commands/skills/extensions,
// so listing them doesn't create a new session per request.
let introspectionRuntimePromise: Promise<any> | null = null;

export function getIntrospectionRuntime() {
  if (!introspectionRuntimePromise) {
    introspectionRuntimePromise = (async () => {
      const projects = getProjects();
      const cwd = projects.flatMap((project) => project.directories).find((directory) => fs.existsSync(directory.path))?.path || process.cwd();
      return buildRuntime(SessionManager.inMemory(cwd), cwd);
    })().catch(err => {
      introspectionRuntimePromise = null; // allow retry on failure
      throw err;
    });
  }
  return introspectionRuntimePromise;
}

// Evict idle, non-streaming runtimes.
export function startEvictionTimer() {
  setInterval(() => {
    runtimeRegistry.evictIdle(RUNTIME_IDLE_MS, (sessionId) => {
      sessionEventSequences.delete(sessionId);
      rejectPendingForSession(sessionId, "session evicted");
      clearSessionStatuses(sessionId);
    });
  }, EVICTION_INTERVAL_MS).unref();
}
