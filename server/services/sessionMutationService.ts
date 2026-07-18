import fs from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getProjectById } from "../projects.ts";
import { appendWorkspaceMetadata, recoverSessionBindingsFromPi } from "../piSessionMetadata.ts";
import { deleteSessionBinding, getSessionBinding, saveSessionBinding, type SessionBinding } from "../sessionBindings.ts";
import { removeSessionScratch } from "../sessionScratch.ts";
import { clearSessionArtifactRequest } from "../uiBridge.ts";
import { hasManagedWorktrees } from "../sessionWorkspace.ts";
import { disposeRuntime, getSettledRuntime } from "../runtime/index.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { removeSessionWorktrees } from "./worktreeService.ts";

async function findSessionManager(sessionId: string, binding?: SessionBinding): Promise<SessionManager | undefined> {
  if (binding?.sessionFile && fs.existsSync(binding.sessionFile)) {
    const manager = SessionManager.open(binding.sessionFile);
    if (manager.getSessionId() === sessionId) return manager;
  }
  try {
    const session = (await SessionManager.listAll()).find((entry) => entry.id === sessionId);
    if (session?.path && fs.existsSync(session.path)) return SessionManager.open(session.path);
  } catch { /* an unavailable global session index is handled as not found */ }
  return undefined;
}

async function resolveSessionBinding(sessionId: string): Promise<{ binding: SessionBinding; manager?: SessionManager }> {
  const existing = getSessionBinding(sessionId);
  const manager = await findSessionManager(sessionId, existing);
  if (existing) return { binding: existing, manager };
  if (!manager) notFound("Session not found");
  const cwd = manager.getCwd?.() || process.cwd();
  return {
    manager,
    binding: {
      sessionId,
      workspaceKind: "directories",
      directoryId: "root",
      cwd,
      directories: [{ directoryId: "root", name: path.basename(cwd) || "workspace", sourcePath: cwd, path: cwd }],
      sessionFile: manager.getSessionFile?.(),
      worktree: false,
    },
  };
}

export interface SessionMutationDependencies {
  recover?: typeof recoverSessionBindingsFromPi;
  getRuntime?: typeof getSettledRuntime;
  dispose?: typeof disposeRuntime;
  removeWorktrees?: typeof removeSessionWorktrees;
}

/** Reassign the organizational project for a session without changing its workspace roots. */
export async function moveSessionToProject(
  sessionId: string,
  requestedProjectId: unknown,
  dependencies: SessionMutationDependencies = {},
) {
  if (requestedProjectId !== null && requestedProjectId !== undefined && typeof requestedProjectId !== "string") {
    badRequest("projectId must be a string or null");
  }
  const projectId = typeof requestedProjectId === "string" && requestedProjectId ? requestedProjectId : undefined;
  const project = projectId ? getProjectById(projectId) : undefined;
  if (projectId && !project) notFound("Project not found");

  await (dependencies.recover ?? recoverSessionBindingsFromPi)();
  const { binding, manager } = await resolveSessionBinding(sessionId);
  const runtime = await (dependencies.getRuntime ?? getSettledRuntime)(sessionId);
  if (runtime?.session?.isStreaming) conflict("Stop the session before moving it");
  if (binding.projectId === projectId) return { success: true, projectId, projectName: project?.name };

  const updated = { ...binding, projectId };
  // Rebuild permission roots and project context on the next turn.
  (dependencies.dispose ?? disposeRuntime)(sessionId, "session moved to another project");
  if (manager) appendWorkspaceMetadata(manager, updated);
  saveSessionBinding(updated);
  return { success: true, projectId, projectName: project?.name };
}

/** Permanently remove chat history. Clean managed worktrees are removed, while their branches are retained. */
export async function deleteSession(sessionId: string, dependencies: SessionMutationDependencies = {}) {
  await (dependencies.recover ?? recoverSessionBindingsFromPi)();
  const binding = getSessionBinding(sessionId);
  const manager = await findSessionManager(sessionId, binding);
  if (!binding && !manager) notFound("Session not found");

  const runtime = await (dependencies.getRuntime ?? getSettledRuntime)(sessionId);
  if (runtime?.session?.isStreaming) conflict("Stop the session before deleting it");

  let branchesKept: Array<string | undefined> = [];
  if (binding && hasManagedWorktrees(binding)) {
    const result = await (dependencies.removeWorktrees ?? removeSessionWorktrees)(sessionId, true);
    branchesKept = result.branches || [];
  }

  (dependencies.dispose ?? disposeRuntime)(sessionId, "session deleted");
  const sessionFile = binding?.sessionFile || manager?.getSessionFile?.();
  if (sessionFile) fs.rmSync(sessionFile, { force: true });
  removeSessionScratch(sessionId);
  clearSessionArtifactRequest(sessionId);
  deleteSessionBinding(sessionId);
  return { success: true, branchesKept: branchesKept.filter((branch): branch is string => !!branch) };
}
