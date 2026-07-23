import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { SessionManager } from "../../../integrations/pi/sessionSdk.ts";
import { WORKTREES_DIR } from "../../../config.ts";
import { createManagedWorktree, discardManagedWorktree, listGitBranches } from "../../git/index.ts";
import { appendWorkspaceMetadata } from "./piSessionMetadata.ts";
import { getProjectById } from "../../projects/projectRepository.ts";
import type { Project } from "../../projects/projectTypes.ts";
import { getSessionBinding, saveSessionBinding } from "./workspaceBindingRepository.ts";
import type { SessionBinding, SessionDirectoryBinding } from "./workspaceTypes.ts";
import { getRawManagedDirectories, getSessionDirectories, hasManagedWorktrees, sourceProjectForSession } from "./sessionWorkspace.ts";
import { disposeRuntime, getOrInitRuntime, getSettledRuntime } from "../../../integrations/pi/runtime/runtimeManager.ts";
import { badRequest, conflict, notFound } from "../../../platform/http/errors.ts";

interface AttachFolderInput {
  path?: unknown;
  name?: unknown;
  baseBranch?: unknown;
}

function validateFolder(input: AttachFolderInput) {
  if (typeof input.path !== "string" || !input.path.trim()) badRequest("Folder path is required");
  const folderPath = path.resolve(input.path.trim());
  let stats: fs.Stats;
  try { stats = fs.statSync(folderPath); } catch { badRequest("Folder not found"); }
  if (!stats.isDirectory()) badRequest("Path is not a folder");
  const name = (typeof input.name === "string" ? input.name.trim() : "") || path.basename(folderPath) || "folder";
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") badRequest("Alias cannot contain path separators");
  return { folderPath: fs.realpathSync(folderPath), name };
}

function requireBinding(sessionId: string): SessionBinding {
  const binding = getSessionBinding(sessionId);
  if (!binding) notFound("Session workspace not found");
  return binding;
}

function sourcePath(directory: SessionDirectoryBinding) {
  const candidate = directory.sourcePath ?? directory.path;
  try { return fs.realpathSync(candidate); } catch { return path.resolve(candidate); }
}

function sessionManagerFor(binding: SessionBinding, runtime?: any): SessionManager {
  if (runtime?.session?.sessionManager) return runtime.session.sessionManager;
  if (binding.sessionFile && fs.existsSync(binding.sessionFile)) return SessionManager.open(binding.sessionFile);
  throw new Error("Session history is unavailable");
}

export async function listAttachFolderBranches(sessionId: string, input: AttachFolderInput) {
  requireBinding(sessionId);
  const { folderPath } = validateFolder(input);
  return { branches: await listGitBranches({ path: folderPath }) };
}

export interface AttachFolderDependencies {
  getBinding?: typeof getSessionBinding;
  getRuntime?: typeof getSettledRuntime;
  dispose?: typeof disposeRuntime;
  initialize?: typeof getOrInitRuntime;
}

/** Attach one source folder to a saved session and rebuild its runtime. */
export async function attachFolderToSession(sessionId: string, input: AttachFolderInput, dependencies: AttachFolderDependencies = {}) {
  const original = (dependencies.getBinding ?? getSessionBinding)(sessionId);
  if (!original) notFound("Session workspace not found");
  const runtime = await (dependencies.getRuntime ?? getSettledRuntime)(sessionId);
  if (runtime?.session?.isStreaming) conflict("Stop the session before adding a folder");
  const { folderPath, name } = validateFolder(input);
  const project = getProjectById(original.projectId) ?? sourceProjectForSession(undefined, original);
  const existingDirectories = getSessionDirectories(project, original);
  if (existingDirectories.some((directory) => sourcePath(directory) === folderPath)) conflict("This folder is already attached to the session");
  if (existingDirectories.some((directory) => directory.name.toLowerCase() === name.toLowerCase())) conflict(`The alias ${name} is already in use`);

  const directoryId = `session-dir-${randomUUID()}`;
  const managed = hasManagedWorktrees(original);
  const baseBranch = typeof input.baseBranch === "string" ? input.baseBranch.trim() : "";
  if (managed && !baseBranch) badRequest("Select a base branch for the new worktree");

  let attached: SessionDirectoryBinding = { directoryId, name, sourcePath: folderPath, path: folderPath };
  let worktreeProject: Project | undefined;
  if (managed) {
    const branch = original.branch ?? existingDirectories.find((directory) => directory.branch)?.branch;
    if (!branch) conflict("The session worktree branch is unavailable");
    worktreeProject = { id: directoryId, name, path: folderPath, directories: [{ id: directoryId, name, path: folderPath }] };
    const existingManaged = getRawManagedDirectories(original);
    const sessionWorktreeRoot = existingManaged[0]?.worktreeRoot
      ? path.dirname(existingManaged[0].worktreeRoot)
      : path.join(WORKTREES_DIR, original.projectId ?? `session-${sessionId}`, sessionId);
    const created = await createManagedWorktree(worktreeProject, path.join(sessionWorktreeRoot, directoryId), baseBranch, branch);
    attached = { ...attached, ...created };
  }

  const firstWorkspaceRoot = original.workspaceKind === "scratch" || existingDirectories.length === 0;
  const updated: SessionBinding = {
    ...original,
    workspaceKind: "directories",
    ...(firstWorkspaceRoot ? { directoryId: attached.directoryId, cwd: attached.path } : {}),
    directories: [...existingDirectories, attached],
    worktree: managed,
  };
  const manager = sessionManagerFor(original, runtime);

  try {
    appendWorkspaceMetadata(manager, updated);
    saveSessionBinding(updated);
    (dependencies.dispose ?? disposeRuntime)(sessionId);
    await (dependencies.initialize ?? getOrInitRuntime)(sessionId);
    return { binding: updated, directory: attached };
  } catch (error) {
    (dependencies.dispose ?? disposeRuntime)(sessionId);
    // Pi metadata is append-only, so append the old binding to make rollback
    // authoritative before restoring the fast index.
    try { appendWorkspaceMetadata(manager, original); } catch { /* retain index recovery below */ }
    saveSessionBinding(original);
    if (worktreeProject && attached.worktreeRoot && attached.branch && attached.baseBranch) {
      await discardManagedWorktree(worktreeProject, {
        path: attached.path,
        worktreeRoot: attached.worktreeRoot,
        branch: attached.branch,
        baseBranch: attached.baseBranch,
      }, WORKTREES_DIR).catch(() => {});
    }
    // Best effort: leave the original session warm again, but preserve the
    // attachment error as the response if rebuilding the old runtime fails.
    await (dependencies.initialize ?? getOrInitRuntime)(sessionId).catch(() => {});
    throw error;
  }
}
